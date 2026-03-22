import mongoose from "mongoose"

const complaintSchema = new mongoose.Schema({
  // ─── Existing fields (unchanged) ──────────────────────────────────────────
  title:       { type: String, required: true },
  description: { type: String, required: true },
  category:    { type: String, required: true, enum: ["Road", "Water", "Electricity", "Sanitation", "Other"] },
  location:    { type: String },       // stored as "lat,lng" string
  image:       { type: String },       // Cloudinary URL
  status:      { type: String, default: "Pending", enum: ["Pending", "In Progress", "Resolved", "Overdue"] },
  citizen:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

  // ─── NEW: Upvoting ────────────────────────────────────────────────────────
  upvotes:      [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  upvoteCount:  { type: Number, default: 0 },
  priority:     { type: String, enum: ["Low", "Medium", "High", "Critical"], default: "Low" },

  // ─── NEW: Department & SLA ────────────────────────────────────────────────
  department:  { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
  slaDeadline: { type: Date },
  slaBreached: { type: Boolean, default: false },

  // ─── NEW: Citizen feedback after resolution ───────────────────────────────
  feedback: {
    rating:      { type: Number, min: 1, max: 5 },
    comment:     { type: String },
    submittedAt: { type: Date },
  },

}, { timestamps: true })

export default mongoose.model("Complaint", complaintSchema)