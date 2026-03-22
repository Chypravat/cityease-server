import express from "express"
import Complaint from "../models/Complaint.js"
import Department from "../models/Department.js"
import auth from "../middleware/auth.js"
import { upload } from "../config/cloudinary.js"
import { io } from "../server.js"

const router = express.Router()

router.post("/", auth, upload.single("image"), async (req, res) => {
  try {
    const { title, description, category, location } = req.body
    const complaint = new Complaint({
      title, description, category, location,
      citizen: req.user.id,
      image: req.file ? req.file.path : ""
    })
    const categoryToDept = {
      Road: "roads-transport", Water: "water-supply",
      Electricity: "electricity", Sanitation: "sanitation-waste", Other: "general-services",
    }
    const dept = await Department.findOne({ slug: categoryToDept[category] || "general-services", isActive: true })
    if (dept) {
      complaint.department = dept._id
      complaint.slaDeadline = new Date(Date.now() + dept.slaHours * 3600 * 1000)
    }
    await complaint.save()
    io.to("admin_room").emit("new_complaint", {
      message: `New complaint: ${title}`, category, time: new Date().toLocaleTimeString()
    })
    res.status(201).json({ message: "Complaint submitted!", complaint })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: "Server error" })
  }
})

router.get("/public/stats", async (req, res) => {
  try {
    const [total, resolved, pending, inProgress, recent] = await Promise.all([
      Complaint.countDocuments(),
      Complaint.countDocuments({ status: "Resolved" }),
      Complaint.countDocuments({ status: "Pending" }),
      Complaint.countDocuments({ status: "In Progress" }),
      Complaint.find().sort({ createdAt: -1 }).limit(5).populate("citizen", "name").select("title category status image upvoteCount createdAt citizen")
    ])
    res.json({ total, resolved, pending, inProgress, recent })
  } catch (error) {
    res.status(500).json({ message: "Server error" })
  }
})

router.get("/heatmap", async (req, res) => {
  try {
    const complaints = await Complaint.find(
      {}, "title category status location upvoteCount createdAt"
    ).lean()
    const points = complaints
      .filter(c => c.location && c.location.includes(","))
      .map(c => {
        const [lat, lng] = c.location.split(",").map(Number)
        return { _id: c._id, title: c.title, category: c.category, status: c.status, upvotes: c.upvoteCount || 0, createdAt: c.createdAt, lat, lng }
      })
      .filter(p => !isNaN(p.lat) && !isNaN(p.lng))
    res.json(points)
  } catch (error) {
    res.status(500).json({ message: "Server error" })
  }
})

router.get("/duplicates", auth, async (req, res) => {
  try {
    const { lat, lng, category } = req.query
    if (!lat || !lng || !category)
      return res.status(400).json({ message: "lat, lng and category are required" })
    const recent = await Complaint.find({
      category,
      status: { $nin: ["Resolved"] },
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    }).select("title status category upvoteCount createdAt location").lean()
    const nearby = recent.filter(c => {
      if (!c.location?.includes(",")) return false
      const [cLat, cLng] = c.location.split(",").map(Number)
      const R = 6371000
      const dLat = (cLat - parseFloat(lat)) * Math.PI / 180
      const dLng = (cLng - parseFloat(lng)) * Math.PI / 180
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(parseFloat(lat) * Math.PI / 180) *
        Math.cos(cLat * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= 300
    })
    res.json(nearby.slice(0, 5))
  } catch (error) {
    res.status(500).json({ message: "Server error" })
  }
})

router.get("/my", auth, async (req, res) => {
  try {
    const complaints = await Complaint.find({ citizen: req.user.id })
      .populate("department", "name slaHours")
      .sort({ createdAt: -1 })
    res.json(complaints)
  } catch (error) {
    res.status(500).json({ message: "Server error" })
  }
})

router.get("/all", auth, async (req, res) => {
  try {
    const complaints = await Complaint.find()
      .populate("citizen", "name email")
      .populate("department", "name")
      .sort({ createdAt: -1 })
    res.json(complaints)
  } catch (error) {
    res.status(500).json({ message: "Server error" })
  }
})

router.post("/:id/upvote", auth, async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id)
    if (!complaint) return res.status(404).json({ message: "Complaint not found" })
    if (String(complaint.citizen) === String(req.user.id))
      return res.status(400).json({ message: "You cannot upvote your own complaint" })
    const alreadyUpvoted = complaint.upvotes?.includes(req.user.id)
    if (alreadyUpvoted) {
      complaint.upvotes = complaint.upvotes.filter(id => String(id) !== String(req.user.id))
      complaint.upvoteCount = Math.max(0, (complaint.upvoteCount || 0) - 1)
    } else {
      if (!complaint.upvotes) complaint.upvotes = []
      complaint.upvotes.push(req.user.id)
      complaint.upvoteCount = (complaint.upvoteCount || 0) + 1
    }
    const count = complaint.upvoteCount
    complaint.priority = count >= 20 ? "Critical" : count >= 10 ? "High" : count >= 5 ? "Medium" : "Low"
    await complaint.save()
    res.json({ upvoted: !alreadyUpvoted, upvoteCount: complaint.upvoteCount, priority: complaint.priority })
  } catch (error) {
    res.status(500).json({ message: "Server error" })
  }
})

router.post("/:id/feedback", auth, async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id)
    if (!complaint) return res.status(404).json({ message: "Complaint not found" })
    if (String(complaint.citizen) !== String(req.user.id))
      return res.status(403).json({ message: "Only the complaint owner can leave feedback" })
    if (complaint.status !== "Resolved")
      return res.status(400).json({ message: "Feedback only allowed on resolved complaints" })
    if (complaint.feedback?.rating)
      return res.status(400).json({ message: "Feedback already submitted" })
    const { rating, comment } = req.body
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ message: "Rating must be 1–5" })
    complaint.feedback = { rating, comment, submittedAt: new Date() }
    await complaint.save()
    res.json({ message: "Feedback submitted!", feedback: complaint.feedback })
  } catch (error) {
    res.status(500).json({ message: "Server error" })
  }
})

router.put("/:id", auth, async (req, res) => {
  try {
    const complaint = await Complaint.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { returnDocument: "after" }
    )
    res.json({ message: "Status updated!", complaint })
  } catch (error) {
    res.status(500).json({ message: "Server error" })
  }
})
// GET /api/complaints/public/feedback  (public — no auth)
router.get("/public/feedback", async (req, res) => {
  try {
    const resolved = await Complaint.countDocuments({ status: "Resolved" })

    const ratings = await Complaint.aggregate([
      { $match: { "feedback.rating": { $exists: true } } },
      { $group: {
        _id: null,
        avg:   { $avg: "$feedback.rating" },
        count: { $sum: 1 },
        five:  { $sum: { $cond: [{ $eq: ["$feedback.rating", 5] }, 1, 0] } },
        four:  { $sum: { $cond: [{ $eq: ["$feedback.rating", 4] }, 1, 0] } },
        three: { $sum: { $cond: [{ $eq: ["$feedback.rating", 3] }, 1, 0] } },
      }}
    ])

    const recent = await Complaint.find(
      { "feedback.rating": { $exists: true } },
      "feedback title category citizen createdAt"
    )
    .populate("citizen", "name")
    .sort({ "feedback.submittedAt": -1 })
    .limit(4)
    .lean()

    res.json({
      avgRating:    ratings[0]?.avg ? +ratings[0].avg.toFixed(1) : null,
      totalRatings: ratings[0]?.count || 0,
      resolved,
      breakdown: {
        five:  ratings[0]?.five  || 0,
        four:  ratings[0]?.four  || 0,
        three: ratings[0]?.three || 0,
      },
      recent: recent.map(c => ({
        id:       c._id,
        title:    c.title,
        category: c.category,
        rating:   c.feedback.rating,
        comment:  c.feedback.comment,
        citizen:  c.citizen?.name,
        date:     c.feedback.submittedAt,
      }))
    })
  } catch (error) {
    res.status(500).json({ message: "Server error" })
  }
})
// GET /api/complaints/track/:id  (public — no auth)
router.get("/track/:id", async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id)
      .populate("citizen", "name")
      .populate("department", "name slaHours email")
      .select("-upvotes")
      .lean()

    if (!complaint) return res.status(404).json({ message: "Complaint not found" })

    res.json({
      _id:         complaint._id,
      title:       complaint.title,
      description: complaint.description,
      category:    complaint.category,
      status:      complaint.status,
      priority:    complaint.priority,
      location:    complaint.location,
      image:       complaint.image,
      createdAt:   complaint.createdAt,
      updatedAt:   complaint.updatedAt,
      citizen:     complaint.citizen?.name,
      department:  complaint.department?.name,
      slaDeadline: complaint.slaDeadline,
      slaBreached: complaint.slaBreached,
      upvoteCount: complaint.upvoteCount,
      feedback:    complaint.feedback,
    })
  } catch (error) {
    res.status(500).json({ message: "Server error" })
  }
})

export default router