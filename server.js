import express from "express"
import dotenv from "dotenv"
import cors from "cors"
import cron from "node-cron"
import { createServer } from "http"
import { Server } from "socket.io"
import connectDB from "./config/db.js"
import authRoutes from "./routes/auth.js"
import complaintRoutes from "./routes/complaints.js"
import departmentRoutes from "./routes/departments.js"   // ✅ NEW
import Complaint from "./models/Complaint.js"             // ✅ NEW (for SLA cron)


dotenv.config()
connectDB()

const app = express()

// ✅ Create HTTP server first
const httpServer = createServer(app)

// ✅ Attach Socket.io to HTTP server
export const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
})

// ✅ Socket.io connection
io.on("connection", (socket) => {
  console.log("User connected:", socket.id)

  socket.on("join_admin", () => {
    socket.join("admin_room")
    console.log("Admin joined admin_room")
  })

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id)
  })
})

app.use(cors())
app.use(express.json())

app.use("/api/auth", authRoutes)
app.use("/api/complaints", complaintRoutes)
app.use("/api/departments", departmentRoutes)   // ✅ NEW

app.get("/", (req, res) => {
  res.send("CityEase API Running!")
})

// ─── ✅ NEW: SLA cron — runs every hour, marks overdue complaints ─────────────
// Checks for complaints past their slaDeadline and marks them Overdue
cron.schedule("0 * * * *", async () => {
  try {
    const now = new Date()

    const overdue = await Complaint.find({
      slaDeadline:  { $lt: now },
      slaBreached:  false,
      status:       { $nin: ["Resolved"] },
    })

    if (overdue.length === 0) return

    const ids = overdue.map(c => c._id)
    await Complaint.updateMany(
      { _id: { $in: ids } },
      { $set: { slaBreached: true, status: "Overdue" } }
    )

    // Notify admin dashboard via socket
    io.to("admin_room").emit("sla_breach", {
      count:      overdue.length,
      complaints: overdue.map(c => ({ id: c._id, title: c.title })),
    })

    console.log(`[SLA Cron] Marked ${overdue.length} complaint(s) as overdue`)
  } catch (err) {
    console.error("[SLA Cron] Error:", err.message)
  }
})

const PORT = process.env.PORT || 5000

// ✅ Use httpServer.listen NOT app.listen
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})