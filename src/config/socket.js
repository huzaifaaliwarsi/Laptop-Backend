const { Server } = require('socket.io');

let io = null;

const initSocket = (httpServer, corsOrigin) => {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Allow connections from localhost, local IP, Vercel, or no origin
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

  io.on('connection', (socket) => {
    // console.log(`[Socket.IO] Client connected: ${socket.id}`);

    socket.on('join_portal', (role) => {
      if (role) {
        socket.join(`role:${role}`);
      }
    });

    socket.on('disconnect', () => {
      // console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

const getIO = () => io;

const emitEvent = (eventName, payload) => {
  if (io) {
    io.emit(eventName, payload);
  }
};

const emitToRole = (role, eventName, payload) => {
  if (io) {
    io.to(`role:${role}`).emit(eventName, payload);
  }
};

module.exports = {
  initSocket,
  getIO,
  emitEvent,
  emitToRole
};
