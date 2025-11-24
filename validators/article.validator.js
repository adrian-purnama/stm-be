const Joi = require('joi');

const objectIdRule = Joi.string().hex().length(24);

const qnaItemSchema = Joi.object({
  question: Joi.string().trim().min(1).required(),
  answer: Joi.string().trim().min(1).required()
});

const createArticleSchema = Joi.object({
  section: Joi.string().trim().min(2).max(120).required(),
  content: Joi.string().allow('', null),
  bodyType: objectIdRule.allow(null, '').optional(),
  qna: Joi.array().items(qnaItemSchema).max(50).default([])
});

const updateArticleSchema = Joi.object({
  section: Joi.string().trim().min(2).max(120),
  content: Joi.string().allow('', null),
  bodyType: objectIdRule.allow(null, '').optional(),
  qna: Joi.array().items(qnaItemSchema).max(50)
}).min(1);

const listArticleSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().trim().allow('', null),
  bodyType: objectIdRule.allow(null, '').optional()
});

module.exports = {
  createArticleSchema,
  updateArticleSchema,
  listArticleSchema
};









