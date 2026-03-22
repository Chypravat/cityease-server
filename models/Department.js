import mongoose from "mongoose"

const departmentSchema = new mongoose.Schema({
  name:       { type: String, required: true, unique: true, trim: true },
  slug:       { type: String, required: true, unique: true, lowercase: true },
  categories: [{ type: String }],
  email:      { type: String },
  slaHours:   { type: Number, default: 48 },
  isActive:   { type: Boolean, default: true },
}, { timestamps: true })

export default mongoose.model("Department", departmentSchema)