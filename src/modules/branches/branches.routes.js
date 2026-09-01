const express = require('express');
const router = express.Router();
const branchManager = require('../../config/branchManager');
const authenticateToken = require('../../middleware/auth');

// GET /api/branches — List registered branches (Read-only for authenticated clients)
router.get('/', async (req, res, next) => {
  try {
    const branches = await branchManager.listBranches();
    return res.json({
      success: true,
      data: branches,
      totalBranches: branches.length,
      maxAllowed: 2,
      canAddMore: branches.length < 2
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/branches/current — Get active branch for the request context
router.get('/current', async (req, res, next) => {
  try {
    const branchId = req.branchId || (req.user?.branchId) || 1;
    const branch = await branchManager.getBranchById(branchId);
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found.'
      });
    }
    return res.json({
      success: true,
      data: branch
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/branches/:id — Get single branch details (Authenticated)
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const branchId = parseInt(req.params.id, 10);
    // Non-superadmin users can only view their own branch info
    if (req.user?.role !== 'super_admin' && req.user?.branchId !== branchId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your assigned branch.'
      });
    }

    const branch = await branchManager.getBranchById(branchId);
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found.'
      });
    }
    return res.json({
      success: true,
      data: branch
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
