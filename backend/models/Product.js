import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name_en: String,
  name_ta: String,
  price: Number,
  original_price: Number, // Add this field
  category: String,
  image_url: String,
  youtube_url: String
});

const Product = mongoose.model('Product', productSchema);

export default Product;
