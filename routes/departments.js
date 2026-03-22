import express from "express"
import Department from "../models/Department.js"
import Complaint from "../models/Complaint.js"
import auth from "../middleware/auth.js"

const router = express.Router()

// GET /api/departments  (public)
router.get("/", async (req, res) => {
  try {
    const departments = await Department.find({ isActive: true })

    const withStats = await Promise.all(departments.map(async (d) => {
      const [total, pending, inProgress, resolved, overdue, ratings] = await Promise.all([
        Complaint.countDocuments({ department: d._id }),
        Complaint.countDocuments({ department: d._id, status: "Pending" }),
        Complaint.countDocuments({ department: d._id, status: "In Progress" }),
        Complaint.countDocuments({ department: d._id, status: "Resolved" }),
        Complaint.countDocuments({ department: d._id, slaBreached: true }),
        Complaint.aggregate([
          { $match: { department: d._id, "feedback.rating": { $exists: true } } },
          { $group: { _id: null, avg: { $avg: "$feedback.rating" }, count: { $sum: 1 } } }
        ])
      ])
      return {
        ...d.toObject(),
        stats: {
          total, pending, inProgress, resolved, overdue,
          resolutionRate: total > 0 ? +((resolved / total) * 100).toFixed(1) : 0,
          avgRating:  ratings[0]?.avg  ? +ratings[0].avg.toFixed(1) : null,
          ratingCount: ratings[0]?.count || 0,
        }
      }
    }))

    res.json(withStats)
  } catch (error) {
    res.status(500).json({ message: "Server error" })
  }
})

// POST /api/departments  (admin only)
router.post("/", auth, async (req, res) => {
  try {
    const dept = await Department.create(req.body)
    res.status(201).json(dept)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

// PUT /api/departments/:id  (admin only)
router.put("/:id", auth, async (req, res) => {
  try {
    const dept = await Department.findByIdAndUpdate(
      req.params.id,
      req.body,
      { returnDocument: "after", runValidators: true }
    )
    if (!dept) return res.status(404).json({ message: "Department not found" })
    res.json(dept)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
})

// DELETE /api/departments/:id  (soft delete)
router.delete("/:id", auth, async (req, res) => {
  try {
    await Department.findByIdAndUpdate(req.params.id, { isActive: false })
    res.json({ message: "Department deactivated" })
  } catch (error) {
    res.status(500).json({ message: "Server error" })
  }
})

export default router