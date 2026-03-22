import express from "express"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import User from "../models/User.js"
import auth from "../middleware/auth.js"

const router = express.Router()

// Register
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body

    const existingUser = await User.findOne({ email })
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = new User({ name, email, password: hashedPassword })
    await user.save()

    res.status(201).json({ message: "User registered successfully" })

  } catch (error) {
    res.status(500).json({ message: "Server error" })
  }
})

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(400).json({ message: "User not found" })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" })
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    )

   res.json({ 
  token, 
  user: { 
    id: user._id, 
    name: user.name, 
    email: user.email,
    role: user.role
  } 
})

  } catch (error) {
    res.status(500).json({ message: "Server error" })
  }
})
// Update profile
router.put("/profile", auth, async (req, res) => {
  try {
    const { name, password } = req.body
    const updateData = { name }

    if(password) {
      const hashedPassword = await bcrypt.hash(password, 10)
      updateData.password = hashedPassword
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { returnDocument: "after" }
    )

    res.json({
      message: "Profile updated!",
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    })

  } catch (error) {
    res.status(500).json({ message: "Server error" })
  }
})

export default router