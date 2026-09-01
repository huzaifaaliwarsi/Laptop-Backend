const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { getBranchStore } = require('../middleware/branchContext');
const branchManager = require('./branchManager');

let io = null;

const initSocket = (httpServer, corsOrigin) => {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(origin) ||
                        /^http:\/\/192\.168\.[0-9]+\.[0-9]+(:[0-9]+)?$/.test(origin);
        const isVercel = /\.vercel\.app$/.test(origin);
        if (isLocal || isVercel || !corsOrigin || corsOrigin === '*' || corsOrigin === origin) {
          return callback(null, true);
        }
        return callback(null, true);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      credentials: true
    }
  });

  // 1. Socket Authentication & Verification Middleware
  io.use(async (socket, next) => {
    try {
      let token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
      if (token && token.startsWith('Bearer ')) {
        token = token.slice(7);
      }
      if (!token && socket.handshake.headers?.cookie) {
        const match = socket.handshake.headers.cookie.match(/(?:^|;\s*)token=([^;]+)/);
        if (match) token = match[1];
      }

      if (!token) {
        // Allow anonymous connection for public views (like client kiosk/status displays)
        socket.user = { role: 'anon', isAnon: true };
        return next();
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026');

      if (decoded.role === 'super_admin') {
        const saRes = await branchManager.masterPool.query(
          'SELECT id, username, name, status FROM master_super_admins WHERE id = $1 LIMIT 1',
          [decoded.id]
        );
        if (saRes.rows.length === 0 || saRes.rows[0].status === 'Inactive') {
          return next(new Error('Super Admin account is inactive or not found.'));
        }
        socket.user = {
          ...saRes.rows[0],
          role: 'super_admin',
          isSuperAdmin: true
        };
        return next();
      }

      // Branch user verification
      const branchId = parseInt(decoded.branchId, 10) || 1;
      const branch = await branchManager.getBranchById(branchId);
      if (!branch || branch.status === 'Inactive') {
        return next(new Error(`Branch ${branchId} is inactive.`));
      }

      socket.user = {
        id: decoded.id,
        username: decoded.username,
        role: decoded.role,
        branchId: branchId,
        isSuperAdmin: false
      };
      next();
    } catch (err) {
      // In case of invalid token, connect as anon without elevated room memberships
      socket.user = { role: 'anon', isAnon: true };
      next();
    }
  });

  // 2. Connection Handler: Automatically joins ONLY verified rooms
  io.on('connection', (socket) => {
    const user = socket.user || { role: 'anon' };

    if (user.isSuperAdmin) {
      socket.join('super_admin');
    } else if (user.branchId) {
      socket.join(`branch_${user.branchId}`);
      if (user.role) {
        socket.join(`branch_${user.branchId}_${user.role}`);
      }
    }

    // Explicitly reject any client-side attempts to join foreign branch rooms
    socket.on('join_branch', (data) => {
      // If superadmin, allow monitoring specific branch
      if (user.isSuperAdmin && data?.branchId) {
        socket.join(`branch_${parseInt(data.branchId, 10)}`);
      }
      // Non-superadmin clients are strictly locked to their verified token room
    });

    socket.on('disconnect', () => {
      // Client disconnected cleanly
    });
  });

  return io;
};

const getIO = () => io;

/**
 * Emit event to branch-specific room to prevent cross-branch leakage
 */
const emitEvent = (eventName, payload, explicitBranchId = null) => {
  if (!io) return;

  const branchId = explicitBranchId || getBranchStore()?.branchId;

  if (branchId) {
    // Emit only to that specific branch's room
    io.to(`branch_${branchId}`).emit(eventName, payload);
    // Also notify Super Admin monitors
    io.to('super_admin').emit(eventName, { ...payload, _branchId: branchId });
  } else {
    // If no branchId is specified, do NOT broadcast sensitive data globally.
    // Notify only super_admin monitors if available.
    io.to('super_admin').emit(eventName, payload);
  }
};

/**
 * Emit event to branch-specific role room
 */
const emitToRole = (role, eventName, payload, explicitBranchId = null) => {
  if (!io) return;

  const branchId = explicitBranchId || getBranchStore()?.branchId;

  if (branchId) {
    io.to(`branch_${branchId}_${role}`).emit(eventName, payload);
    io.to('super_admin').emit(eventName, { ...payload, _branchId: branchId, _role: role });
  } else {
    io.to('super_admin').emit(eventName, { ...payload, _role: role });
  }
};

module.exports = {
  initSocket,
  getIO,
  emitEvent,
  emitToRole
};
