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
  description: { 
    type: String, 
    default: '' 
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
