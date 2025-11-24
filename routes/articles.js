const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const articleController = require('../controllers/article.controller');

router.get('/', authenticateToken, authorize(['placeholder_test']), articleController.getArticles);
router.get('/:id', authenticateToken, authorize(['placeholder_test']), articleController.getArticleById);
router.post('/', authenticateToken, authorize(['placeholder_test']), articleController.createArticle);
router.put('/:id', authenticateToken, authorize(['placeholder_test']), articleController.updateArticle);
router.delete('/:id', authenticateToken, authorize(['placeholder_test']), articleController.deleteArticle);

module.exports = router;









