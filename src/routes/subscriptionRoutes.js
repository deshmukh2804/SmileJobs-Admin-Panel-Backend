// FILE: backend/src/routes/subscriptionRoutes.js
const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');

// Plan CRUD
router.get('/plans', subscriptionController.getPlans);
router.post('/plans', subscriptionController.createPlan);
router.put('/plans/:id', subscriptionController.updatePlan);
router.patch('/plans/:id/toggle', subscriptionController.togglePlanStatus);
router.delete('/plans/:id', subscriptionController.deletePlan);

// Bulk create (used by "Quick Setup" button on frontend)
router.post('/plans/bulk', subscriptionController.bulkCreatePlans);

// Transactions & analytics
router.get('/transactions', subscriptionController.getTransactions);
router.get('/analytics', subscriptionController.getBillingAnalytics);
router.post('/mock-transaction', subscriptionController.generateMockTransaction);

module.exports = router;