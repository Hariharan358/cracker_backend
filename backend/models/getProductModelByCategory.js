// ✅ Dynamic model generator
import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name_en: String,
  name_ta: String,
  price: Number,
  original_price: Number,
  // Ordering index within a category
  order: { type: Number, default: 0, index: true },
  imageUrl: String,
  youtube_url: String,
  category: String,
}, { timestamps: true });

const modelCache = {};

export function getProductModelByCategory(category) {
  const modelName = category.replace(/\s+/g, '_').toUpperCase();

  if (!modelCache[modelName]) {
    modelCache[modelName] = mongoose.model(
      modelName,
      productSchema,
      modelName // use model name also as collection name
    );
  }

  return modelCache[modelName];
}
