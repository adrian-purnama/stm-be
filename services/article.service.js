const mongoose = require('mongoose');
const Article = require('../models/article.model');
const BodyType = require('../models/bodyType.model');

const buildQnaPayload = (qna = []) => {
  if (!Array.isArray(qna)) {
    return [];
  }

  return qna
    .filter(item => item && item.question && item.answer)
    .map(item => ({
      question: item.question.trim(),
      answer: item.answer.trim()
    }));
};

const validateBodyTypeReference = async (bodyTypeId) => {
  if (!bodyTypeId) {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(bodyTypeId)) {
    const error = new Error('Invalid body type reference');
    error.statusCode = 400;
    throw error;
  }

  const bodyType = await BodyType.findById(bodyTypeId);
  if (!bodyType) {
    const error = new Error('Associated body type not found');
    error.statusCode = 404;
    throw error;
  }

  return bodyType._id;
};

const createArticle = async ({ section, content, bodyType, qna, createdBy }) => {
  const article = new Article({
    section: section.trim(),
    content: content ? content.trim() : '',
    qna: buildQnaPayload(qna),
    createdBy
  });

  if (bodyType) {
    article.bodyType = await validateBodyTypeReference(bodyType);
  }

  await article.save();

  return Article.findById(article._id)
    .populate('bodyType', 'name shortName')
    .populate('createdBy', 'fullName email')
    .populate('lastModifiedBy', 'fullName email');
};

const getArticles = async ({ page = 1, limit = 10, search, bodyType }) => {
  const filter = {};

  if (search) {
    const regex = new RegExp(search, 'i');
    filter.$or = [
      { section: regex },
      { content: regex },
      { 'qna.question': regex },
      { 'qna.answer': regex }
    ];
  }

  if (bodyType) {
    filter.bodyType = await validateBodyTypeReference(bodyType);
  }

  const skip = (page - 1) * limit;

  const [articles, total] = await Promise.all([
    Article.find(filter)
      .populate('bodyType', 'name shortName')
      .populate('createdBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Article.countDocuments(filter)
  ]);

  return {
    articles,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

const getArticleById = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error('Invalid article id');
    error.statusCode = 400;
    throw error;
  }

  const article = await Article.findById(id)
    .populate('bodyType', 'name shortName')
    .populate('createdBy', 'fullName email')
    .populate('lastModifiedBy', 'fullName email');

  if (!article) {
    const error = new Error('Article not found');
    error.statusCode = 404;
    throw error;
  }

  return article;
};

const updateArticle = async (id, updates, userId) => {
  const article = await getArticleById(id);

  if (updates.section !== undefined) {
    article.section = updates.section.trim();
  }

  if (updates.content !== undefined) {
    article.content = updates.content ? updates.content.trim() : '';
  }

  if (updates.bodyType !== undefined) {
    if (!updates.bodyType) {
      article.bodyType = null;
    } else {
      article.bodyType = await validateBodyTypeReference(updates.bodyType);
    }
  }

  if (updates.qna !== undefined) {
    article.qna = buildQnaPayload(updates.qna);
  }

  article.lastModifiedBy = userId;

  await article.save();

  return Article.findById(article._id)
    .populate('bodyType', 'name shortName')
    .populate('createdBy', 'fullName email')
    .populate('lastModifiedBy', 'fullName email');
};

const deleteArticle = async (id) => {
  const article = await getArticleById(id);
  await Article.deleteOne({ _id: article._id });
  return true;
};

module.exports = {
  createArticle,
  getArticles,
  getArticleById,
  updateArticle,
  deleteArticle
};









