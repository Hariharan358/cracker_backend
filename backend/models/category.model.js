// models/category.model.js
import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    unique: true,
    uppercase: true,
    trim: true
  },
  displayName: { 
    type: String, 
    required: true,
    trim: true
  },
  displayName_en: { 
    type: String, 
    trim: true
  },
  displayName_ta: { 
    type: String, 
    trim: true
  },
  // Optional icon image URL for showing category icon in UI
  iconUrl: {
    type: String,
    default: ''
  },
  description: { 
    type: String, 
    default: '' 
  },
  // Display order for custom sorting in UI
  order: {
    type: Number,
    default: 0,
    index: true
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
}, { 
  timestamps: true,
  collection: 'categories'
});

// Ensure unique index on name
categorySchema.index({ name: 1 }, { unique: true });

export const Category = mongoose.model('Category', categorySchema);
