const express = require('express');
const router = express.Router();
const multer = require('multer');
const kycController = require('../controllers/kyc.controller');
const protect = require('../middleware/auth.middleware');
const isAdmin = require('../middleware/admin.middleware');

const storage = multer.memoryStorage();
const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }
});

router.post('/submit', protect, upload.fields([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 },
    { name: 'full', maxCount: 1 },
    { name: 'pan_image', maxCount: 1 }
]), kycController.submitKYC);

router.get('/admin/list', isAdmin, kycController.getAdminKYCList);
router.post('/admin/review', isAdmin, kycController.reviewKYC);

module.exports = router;
