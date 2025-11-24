const {
  sendSuccessResponse,
  sendErrorResponse,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES
} = require('../utils/errorHandler');
const {
  createArticleSchema,
  updateArticleSchema,
  listArticleSchema
} = require('../validators/article.validator');
const articleService = require('../services/article.service');

const formatValidationError = (error) => error.details.map(detail => detail.message).join(', ');

const createArticle = async (req, res) => {
  const { error, value } = createArticleSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return sendErrorResponse(res, 400, ERROR_MESSAGES.VALIDATION_FAILED, formatValidationError(error));
  }

  try {
    const article = await articleService.createArticle({
      ...value,
      createdBy: req.user.userId
    });

    return sendSuccessResponse(res, 201, 'Article created successfully', article);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    return sendErrorResponse(res, status, message);
  }
};

const getArticles = async (req, res) => {
  const { error, value } = listArticleSchema.validate(req.query, { abortEarly: false });
  if (error) {
    return sendErrorResponse(res, 400, ERROR_MESSAGES.VALIDATION_FAILED, formatValidationError(error));
  }

  try {
    const { articles, pagination } = await articleService.getArticles(value);
    return sendSuccessResponse(res, 200, 'Articles retrieved successfully', articles, pagination);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    return sendErrorResponse(res, status, message);
  }
};

const getArticleById = async (req, res) => {
  try {
    const article = await articleService.getArticleById(req.params.id);
    return sendSuccessResponse(res, 200, SUCCESS_MESSAGES.RETRIEVED, article);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    return sendErrorResponse(res, status, message);
  }
};

const updateArticle = async (req, res) => {
  const { error, value } = updateArticleSchema.validate(req.body, { abortEarly: false });

  if (error) {
    return sendErrorResponse(res, 400, ERROR_MESSAGES.VALIDATION_FAILED, formatValidationError(error));
  }

  try {
    const article = await articleService.updateArticle(req.params.id, value, req.user.userId);
    return sendSuccessResponse(res, 200, SUCCESS_MESSAGES.UPDATED, article);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    return sendErrorResponse(res, status, message);
  }
};

const deleteArticle = async (req, res) => {
  try {
    await articleService.deleteArticle(req.params.id);
    return sendSuccessResponse(res, 200, SUCCESS_MESSAGES.DELETED);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = status === 500 ? ERROR_MESSAGES.INTERNAL_ERROR : err.message;
    return sendErrorResponse(res, status, message);
  }
};

module.exports = {
  createArticle,
  getArticles,
  getArticleById,
  updateArticle,
  deleteArticle
};









