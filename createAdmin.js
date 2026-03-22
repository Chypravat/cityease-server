import mongoose from "mongoose"
import bcrypt from "bcryptjs"
import dotenv from "dotenv"
import User from "./models/User.js"

dotenv.config()

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const hashedPassword = await bcrypt.hash("admin123", 10)
  
  const admin = new User({
    name: "Admin",
    email: "admin@cityease.com",
    password: hashedPassword,
    role: "admin"
  })

  await admin.save()
  console.log("Admin created successfully!")
  console.log("Email: admin@cityease.com")
  console.log("Password: admin123")
  process.exit()
}).catch(err => {
  console.log(err)
  process.exit()
})