const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const compression = require('compression');
require('dotenv').config();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const multer = require("multer");
const nodemailer = require('nodemailer')
const archiver = require("archiver");
const cron = require('node-cron')
const Razorpay = require('razorpay')
const crypto = require('crypto');
const { StandardFonts } = require('pdf-lib');
const path = require("path")
const { PDFDocument, rgb } = require('pdf-lib');
const fs = require("fs");
const morgan = require('morgan');
const { getCache, setCache } = require('./utils/redisCache');
const { buildBranchQuery, getDashboardSummary, getDashboardEnquiries } = require('./services/dashboardService');
const app = express();
app.use(compression()); // gzip all responses
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));
app.use((req, res, next) => {
  const label = `${req.method} ${req.originalUrl}`;
  console.time(label);
  res.on('finish', () => {
    console.timeEnd(label);
  });
  next();
});
const DASHBOARD_CACHE_TTL = Number(process.env.DASHBOARD_CACHE_TTL) || 60;
app.use("/profile", express.static(path.join(__dirname, "profile")));
app.use("/Reciepts", express.static(path.join(__dirname, "Reciepts")));

const normalizeRole = (role) =>
  String(role || "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const getRolesFromUser = (user) => {
  if (!user) return [];
  const source = Array.isArray(user.roles)
    ? user.roles
    : Array.isArray(user.role)
      ? user.role
      : user.role
        ? [user.role]
        : [];
  return source.map(normalizeRole);
};

const isSuperAdminUser = (user) => getRolesFromUser(user).includes("superadmin");
const isSubAdminUser = (user) => {
  const roles = getRolesFromUser(user);
  return roles.includes("subadmin") || roles.includes("branchadmin");
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Authentication required" });

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your_jwt_secret",
    );
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

const requireSuperAdmin = (req, res, next) => {
  if (!isSuperAdminUser(req.user)) {
    return res
      .status(403)
      .json({ message: "Only Super Admin can perform this action" });
  }
  return next();
};
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://excerpttech:excerpttech2021@cluster0.5vdeszu.mongodb.net/JBKCRMDB', {
  maxPoolSize: 20,
  minPoolSize: 5,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
if (process.env.MONGO_DEBUG === 'true') {
  mongoose.set('debug', function (coll, method, query, doc, options) {
    console.log(`MONGODB DEBUG => ${coll}.${method}`, JSON.stringify(query), JSON.stringify(doc));
  });
}
db.once('open', () => {
  console.log('Connected to MongoDB');
});

const transporter = nodemailer.createTransport({
  host: 'smtp.hostinger.com', // Use smtp.hostinger.com, not mail.hostinger.com
  port: 465,
  secure: true, // SSL
  auth: {
    user: 'info@jbkacademy.in', // Lowercase recommended
    pass: 'Karthik@9581766526',
  },
  logger: true,
  debug: true
});
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_live_Gf0A8h4qzBNpaS',
  key_secret: process.env.RAZORPAY_KEY_SECRET || '5u5fiivtWw2oo1hfXKwvvfTK'
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage: storage });

const hrdocument = path.join(__dirname, 'hrdocument');
if (!fs.existsSync(hrdocument)) {
  fs.mkdirSync(hrdocument, { recursive: true });
}

// Define documentUploadDir here
const documentUploadDir = path.join(__dirname, 'documents');
if (!fs.existsSync(documentUploadDir)) {
  fs.mkdirSync(documentUploadDir, { recursive: true });
}

const storage2 = multer.diskStorage({
  destination: function (req, file, cb) {
    const facultyDir = path.join(documentUploadDir, 'uploads');
    if (!fs.existsSync(facultyDir)) {
      fs.mkdirSync(facultyDir, { recursive: true });
    }
    cb(null, facultyDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload2 = multer({
  storage: storage2,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const allowedFileTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
    const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
    if (extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image, PDF, and document files are allowed!'));
    }
  }
});

const uploadDir = path.join(__dirname, '/profile');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage12 = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Use firstName to name the file, plus a timestamp to avoid conflicts
    const firstName = req.body.firstName || 'unknown';
    const fileExt = path.extname(file.originalname);
    cb(null, `${firstName}-${Date.now()}${fileExt}`);
  }
});

const upload12 = multer({
  storage: storage12,  // FIXED: Use 'storage' instead of 'storage12'
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

const storage1 = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload1 = multer({ storage: storage1 });

const jobresumestorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "resumes/"); // Ensure this folder exists
  },
  filename: (req, file, cb) => {
    const applicantName = req.body.name ? req.body.name.replace(/\s+/g, "_") : "resume";
    const fileExtension = path.extname(file.originalname);
    if (file.fieldname === "resume") {
      cb(null, `${applicantName}_resume_${Date.now()}${fileExtension}`);
    } else if (file.fieldname === "coverLetter") {
      cb(null, `${applicantName}_coverLetter_${Date.now()}${fileExtension}`);
    } else if (file.fieldname === "certificate") {
      cb(null, `${applicantName}_certificate_${Date.now()}${fileExtension}`);
    } 
  }
});
  
const resumeupload = multer({ storage: jobresumestorage });

app.use("/resumes", express.static(path.join(__dirname, "resumes")));

const profileStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'profile';

    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Create unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, 'profile-' + uniqueSuffix + extension);
  }
});

// Create upload middleware for profile photos
const uploadProfilePhoto = multer({
  storage: profileStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const branchSchema = new mongoose.Schema({
  branchId: {
    type: String,
    required: true,
    unique: true
  },
  branchName: {
    type: String,
    required: true
  },
  location: {
    type: String,
    required: true
  },
  email:{
    type: String,
  },
  phone: {
    type: String,
  },
  fulladdress: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

branchSchema.index({ branchId: 1 });

const Branch = mongoose.model('Branch', branchSchema);

const batchSchema = new mongoose.Schema({
  MasterBranchID: { type: mongoose.Schema.Types.ObjectId, ref: "MasterBranch", required: true },
  branchId: { type: String, },
  batchId: { type: String, required: true },
  batchName: { type: String, required: true },
 
   subject: [
        {
            subject: { type: String, required: true },
            faculty: { type: mongoose.Schema.Types.ObjectId, ref: "Faculty", required: true },
            schedule: [
              {
                day: { type: String, required: true },  // "Monday", "Tuesday", etc.
                timeSlot: { type: String, required: true },  // "9:00 AM-10:30 AM"
                hoursPerDay: { type: Number, required: true }
              }
            ]
        }
    ],
  faculty: { type: mongoose.Schema.Types.ObjectId, ref: "Faculty" },
  studentCount: { type: Number, required: true },
  remainingStudentCount: { type: Number, default: 0 },
  assignedStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: "Registration" }],
  startDate: { type: String, required: true },
  status: {
    type: String,
    enum: ["to be start", "running", "complete", "hold", "cancelled"],
    default: "to be start"
  },
  batchMode: {
    type: String,
    enum: ["regular", "weekend", "special"],
    default: "regular"
  },
  classMode:String,
  awardedDate: { type: String },
  duration: { type: Number },
  expectedFinishingDate: { type: String },
  createdAt: { type: Date, default: Date.now }
});
batchSchema.index({ MasterBranchID: 1 });
batchSchema.index({ branchId: 1 });
batchSchema.index({ status: 1 });
batchSchema.index({ branchId: 1, status: 1, createdAt: -1 });
const Batch = mongoose.model("Batch", batchSchema);

const BatchInterestSchema = new mongoose.Schema({
  // User reference
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Registration',
    required: true
  },
  // Batch reference
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  // Status of interest
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  // Registration details
  regDetails: {
    fName: String,
    lName: String,
    guardianName: String,
    contactAddress: String,
    email: String,
    city: String,
    source: String,
    ReferralName: String,
    state: String,
    branchId: String,
    qualification: String,
    otherQualification: String,
    collegeName: String,
    phone: String, regid: String,
  },
  // Course details
  courseDetails: {
    courseTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CourseType'
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course'
    },
    selectedSubjects: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject'
    }],
    courseName: String,
    courseFee: String
  },
  notes: String,

  createdAt: {
    type: Date,
    default: Date.now
  }
});

const BatchInterest = mongoose.model('BatchInterest', BatchInterestSchema);

const PaymentPlanSchema = new mongoose.Schema({
  dueDate: String,
  amount: Number,
  status: { type: String, default: "Pending" },
  paidDate: String,
  paidAmount: Number,
  transactionId: String,
  receivedBy: String,
  receiptPath: String, 
  receiptId: String,
  paymentMode: { type: String},
});

const RegistrationSchema = new mongoose.Schema({
   branchId: String,
  regid: { type: String, unique: true, sparse: true },
  fName: String,
  lName: String,
  guardianName: String,
  contactAddress: String,
  email: String,          
  city: String,
  source: String,
  ReferralName: String,
  state: String,
 
  qualification: String,
  otherQualification: String,
  collegeName: String,
  phone: String,
  courseName: String,
  // Add these fields to your existing schema
  courseTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CourseType',
    required: true
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  selectedSubjects: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject'
  }],

  courseFee: String,
  masterBranchId: { type: mongoose.Schema.Types.ObjectId, ref: "MasterBranch" },
  joiningDate: String,
  aadhar: String,
  resume: String,
   profilePhoto: String,
  Grade: String,
  role: { type: [String], default: ["Student"] },
  password: { type: String, },
  feeType: { type: String, default: "Single" },
  installmentCount: { type: Number, default: 0 },
  formStatus: { type: String, default: "Pending" },
  regStatus: { type: String, default: "Pending" },
  approvedAt: { type: Date },
  totalPaid: { type: Number, default: 0 },
  remainingAmount: { type: Number, default: 0 },
  singlePaymentStatus: {
    type: String,

    default: 'Pending'
  },
  singlePaymentDate: {
    type: Date
  },
  singlepaymentrecivedby: String,
  singlePaymentMode:String,
  singlePaymentReceiptId:String,

  singlePaymentTransactionId: {
    type: String
  },
  offeredFee: String,
  paymentsPlan: [PaymentPlanSchema],
  resetCode: String,
  receiptId: String,
  resetCodeExpiry: Date
}, { timestamps: true });

RegistrationSchema.index({ branchId: 1 });
RegistrationSchema.index({ masterBranchId: 1 });
RegistrationSchema.index({ courseTypeId: 1 });
RegistrationSchema.index({ regStatus: 1 });
RegistrationSchema.index({ createdAt: 1 });
RegistrationSchema.index({ branchId: 1, createdAt: -1 });
RegistrationSchema.index({ branchId: 1, regStatus: 1, createdAt: -1 });

const CounterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model("Counter", CounterSchema);

const Registration = mongoose.model("Registration", RegistrationSchema);




const timetableSchema = new mongoose.Schema({
  batchId: { type: String, required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course" },
  schedule: [{
    day: { type: String, required: true }, // Monday, Tuesday, etc.
    timeSlot: { type: String, required: true } // "08:00-09:00", etc.
  }],
  subject: {
    subjectCode: String,
    subjectName: String
  },
  faculty: {
    employeeId: String,
    firstName: String,
    lastName: String
  }
});

const Timetable = mongoose.model("Timetable", timetableSchema);

const facultySchema = new mongoose.Schema({
  MasterBranchID: { type: mongoose.Schema.Types.ObjectId, ref: "MasterBranch" },
  branchId: String,
  firstName: String,
  lastName: String,
  email: String,
  phone: String,
  role: [],
  department: String,
  qualification: String,
  otherQualification: String,
  experience: Number,
  dob: String,
  joinDate: String,
  address: String,
  gender: String,
  employmentType: String,
  status: String,
  salary: String,
  employeeId: String,
  subjects: [{ subjectCode: String, subjectName: String }],
  password: String,

  profilePhoto: String,
  resetCode: String,
  resetCodeExpiry: Date,
  Feedbacks: [
    {
      studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Registration" },
      course: String,
      batch: String,
      rating: String,
      review: String,
      subject: String
    }
  ],
  assignedEnquiries: [{ type: mongoose.Schema.Types.ObjectId, ref: "Enquiry" }],
  followUps: [
    {
      enquiryId: { type: mongoose.Schema.Types.ObjectId, ref: "Enquiry" },
      status: String,
      followedUpDate: String,  // Today's date when the follow-up was done
      nextFollowUpDate: String,
      remark: String
    }
  ],
  // New document fields
  documents: {
    photo: {
      filename: String,
      path: String,
      contentType: String,
      uploadDate: { type: Date, default: Date.now }
    },
    offerLetter: {
      filename: String,
      path: String,
      contentType: String,
      uploadDate: { type: Date, default: Date.now }
    },
    idProof: {
      filename: String,
      path: String,
      contentType: String,
      uploadDate: { type: Date, default: Date.now }
    },
    addressProof: {
      filename: String,
      path: String,
      contentType: String,
      uploadDate: { type: Date, default: Date.now }
    },
    educationCertificates: {
      filename: String,
      path: String,
      contentType: String,
      uploadDate: { type: Date, default: Date.now }
    },
    bankDetails: {
      filename: String,
      path: String,
      contentType: String,
      uploadDate: { type: Date, default: Date.now }
    }
  }
}, { timestamps: true });

facultySchema.index({ branchId: 1 });
facultySchema.index({ MasterBranchID: 1 });
facultySchema.index({ status: 1 });
facultySchema.index({ branchId: 1, status: 1 });

const Faculty = mongoose.model("Faculty", facultySchema);

const salaryRecordSchema = new mongoose.Schema({
  facultyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Faculty",
  },
  employeeId: String,
  salary: Number,
  month: String,
  year: String,
  leaveCount: { type: Number, default: 0 },
  deductionPerDay: { type: Number, default: 0 },
  totalDeduction: { type: Number, default: 0 },
  payableSalary: Number,
  date: Date,
}, { timestamps: true });

const SalaryRecord = mongoose.model("SalaryRecord", salaryRecordSchema);

const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, default: "user" }
});
const User = mongoose.model("User", UserSchema);

const PermissionSchema = new mongoose.Schema({
  name: String,
  subPermissions: [String]
});
const Permission = mongoose.model("Permission", PermissionSchema);

const RoleSchema = new mongoose.Schema({
  roleId: String,
  roleName: String,
  // We'll keep the original flat permissions array for backward compatibility
  permissions: [String],
  // Add a new structured permissions field
  structuredPermissions: [PermissionSchema]
});

const Role = mongoose.model("Role", RoleSchema);

const CounterSchemarole = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});

const Counterrole = mongoose.model('Counterrole', CounterSchemarole);

const enquirySchema = new mongoose.Schema({
  MasterBranchID: { type: mongoose.Schema.Types.ObjectId, ref: "MasterBranch" },
  branchId: String,
  courseTypeId: String,
  courseId: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course', // <-- Must exactly match model name
    required: true
  }],
  // interestedSubjects: [String], // Array of subject IDs
    interestedSubjects: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true
    }],
  email: { type: String, required: true },
  firstname: { type: String, required: true },
  lastname: { type: String},
  mobileNumber: { type: String, required: true },

  qualification: { type: String, required: true },
  state: { type: String, required: true },
  city: { type: String, required: true },
  CurrentOccupationStatus: { type: String},
  formatting:String,
  ModeofLearning: { type: String}, // "Online", "Offline", "Hybrid"
  qualification: { type: String, required: true },
  otherQualification: { type: String },
  yearOfPassout: { type: Number, required: true },
    othercourseorsoftware: { type: String },
  // interestedCourses: { type: String, required: true },
  CollegeName: { type: String, required: true },
  referralSource: { type: String, required: true },
  ReferenceneName: { type: String },
  joiningPlan: { type: String, required: true },
  status: { type: String, default: 'unassigned' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Faculty" },
  followUps: [
    {
      teleCaller: { type: mongoose.Schema.Types.ObjectId, ref: "Faculty" },
      status: String,
      followedUpDate: String,  // Today's date when the follow-up was done
      nextFollowUpDate: String,
      remark: String
    }
  ]
}, { timestamps: true });
enquirySchema.index({ branchId: 1 });
enquirySchema.index({ assignedTo: 1 });
enquirySchema.index({ MasterBranchID: 1 });
enquirySchema.index({ status: 1 });
enquirySchema.index({ createdAt: 1 });
enquirySchema.index({ branchId: 1, status: 1, createdAt: -1 });
const Enquiry = mongoose.model("Enquiry", enquirySchema);

const leaveSchema = new mongoose.Schema({
  employeeName: String,
  employeeId: String,
  name: String,
  leaveType: String,
  fromDate: Date,
  toDate: Date,
  reason: String,
  status: { type: String, default: "Pending" }, // Default status
  requestedDate: { type: Date, default: Date.now }
}, { timestamps: true });

const Leave = mongoose.model("Leave", leaveSchema);


// const InvoiceSchema = new mongoose.Schema({
//   branch: String,
//   branchName: String,
//   invoiceNo: String,  // Ensure invoiceNo is included
//   invoiceDate: String,
//   // dueDate: String,
//   amount: Number,
//   // status: String,
//   paymentDate: String,
//   paymentMode: String,
//   item: String,
//   transactionId: String,
//   remarks: String
// });

// const Invoice = mongoose.model('Invoice', InvoiceSchema);
const InvoiceSchema = new mongoose.Schema({
  branch: String,
    masterBranchId: { type: mongoose.Schema.Types.ObjectId, ref: "MasterBranch", required: true },
  branchName: String,

  invoiceNo: { type: String, unique: true }, // Ensure invoiceNo is included
  invoiceDate: String,
  // dueDate: String,
  amount: Number,
  // status: String,
  paymentDate: String,
  paymentMode: String,
  item: String,
  transactionId: String,
  remarks: String
}, { timestamps: true });

const Invoice = mongoose.model('Invoice', InvoiceSchema);

const counterSchema = new mongoose.Schema({
  branch: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

const InvoiceCounter = mongoose.model('InvoiceCounter', counterSchema);

const eventSchema = new mongoose.Schema({
  MasterBranchID: { type: mongoose.Schema.Types.ObjectId, ref: "MasterBranch", required: true },
  branchId: { type: String, required: true },
  eventName: { type: String, required: true },
  date: { type: Date, required: true },
  participants: { type: [String], required: true }, // Store as an array: ["Student", "Faculty"]
  description: { type: String, required: true },
  facultyArray: [{ type: mongoose.Schema.Types.ObjectId, ref: "Faculty" }], // Array of faculty IDs
  studentArray: [{ type: mongoose.Schema.Types.ObjectId, ref: "Registration" }], // Array of student IDs
  batchArray: [{ type: mongoose.Schema.Types.ObjectId, ref: "Batch" }] // Array of batch IDs
});

eventSchema.index({ branchId: 1 });
eventSchema.index({ MasterBranchID: 1 });
eventSchema.index({ date: 1 });

const Event = mongoose.model("Event", eventSchema);

const attendanceSchema = new mongoose.Schema({
  date: String,
  month: String,
  year: String,
  facultyAttendance: [
    {
      facultyId: String,
      facultyName: String,
      department: String,
      inTime: String,
      outTime: String,
    },
  ],
});

const AttendanceModel = mongoose.model("Attendance", attendanceSchema);

const announcementSchema = new mongoose.Schema({
  facultyId: { type: mongoose.Schema.Types.ObjectId, ref: "Faculty", required: true },
  branchId: { type: String, required: true },
  date: { type: String, required: true },
  batches: [{ // Change to array of batch objects
    batchId: { type: String, required: true },
    batchName: { type: String, required: true },
    subjectCode: { type: String, required: true }
  }],
  announcementName: String,
  description: { type: String, required: true },
});

const Announcement = mongoose.model("Announcement", announcementSchema);

const jobRequirementSchema = new mongoose.Schema({
  jobId: { type: String, unique: true }, // Add this field
  branchId: String, // Add this field
  companyName: String,
  jobTitle: String,
  jobType: String,
  durationOfWork: String,
  salaryRange: String,
  location: String,
  workType: String,
  requiredSkills: String,
  experience: String,
  yearsOfExperience: String,
  education: [String],
  qualification: String,
  otherQualification: String,
  jobDescription: String,
  contactEmail: String,
  status: {
    type: String,
    default: 'Open'  // or 'Pending', 'Draft', etc.—whatever suits your use case
  },       // New field
  deadline: String,
  postedDate: {
    type: Date,
    default: Date.now  // This sets today's date by default
  }
});

const JobRequirement = mongoose.model('JobRequirement', jobRequirementSchema);

const jobApplicationSchema = new mongoose.Schema({
  jobId: String,
  name: String,
  gender: String,
  contactInfo: String,
  email: String,
  phoneNumber: String,
  education: String,
  experience: String,
  experienceDetails: {
    companyName: String,
    jobTitle: String,
    isCurrentEmployer: Boolean,
    fromDate: String,
    toDate: String,
    location: String
  },
  skills: String,
  resume: String,
  linkedIn: String,
  certificate:String,
  regId:String,
  coverLetter: String,
  availability: String
});

const jobApplication = mongoose.model("jobApplication", jobApplicationSchema);

const studentAttendanceSchema = new mongoose.Schema({
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Batch",
    required: true
  },
  date: {
    type: String,
    required: true  // Format: YYYY-MM-DD
  },
  students: [
    {
      studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Registration",  // ✅ FIXED reference
        required: true
      },
      status: {
        type: String,
        enum: ["full-day", "half-day", "absent"],
        required: true
      }
    }
  ]
}, { timestamps: true });

const StudentAttendance = mongoose.model("StudentAttendance", studentAttendanceSchema);

const departmentSchema = new mongoose.Schema({
  dep_id: { type: String, required: true, unique: true },
  departmentName: { type: String, required: true },
});

const Department = mongoose.model('Department', departmentSchema);


const ReceiptCounterSchema = new mongoose.Schema({
  branchId: String,
  year: Number,
  count: { type: Number, default: 0 }
});

const ReceiptCounter = mongoose.model('ReceiptCounter', ReceiptCounterSchema);


const masterbranchSchema = new mongoose.Schema({
  MasterBranchName: String,
  BranchesID: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch'
  }]
});

masterbranchSchema.index({ MasterBranchName: 1 });

const MasterBranch = mongoose.model('MasterBranch', masterbranchSchema);

const coursetypeSchema = new mongoose.Schema({
  CourseTypeId: {
    type: String,
    required: true,
    unique: true
  },
  CourseTypeName: {
    type: String,
    required: true
  },
  MasterBranchID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MasterBranch',
    required: true
  },

});

coursetypeSchema.index({ MasterBranchID: 1 });

const CourseType = mongoose.model('CourseType', coursetypeSchema);


const courseSchema = new mongoose.Schema({
  CourseID: {
    type: String,
    required: true,
    unique: true
  },
  CourseName: {
    type: String,
    required: true
  },
  CourseTypeID: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CourseType',
    required: true
  }],
  MasterBranchID: { type: mongoose.Schema.Types.ObjectId, ref: "MasterBranch", required: true },
  duration: {
    value: {
      type: Number,
      default: 0
    },
    unit: {
      type: String,
      enum: ['Months', 'Days'],
      default: 'Months'
    }
  },
  payment: {
    single: {
      type: Number,
      default: 0
    },
    installment: {
      type: Number,
      default: 0
    }
  }
});

courseSchema.index({ MasterBranchID: 1 });

const Course = mongoose.model('Course', courseSchema);


const subjectSchema = new mongoose.Schema({
  SubjectId: {
    type: String,
    required: true,
    unique: true
  },
  SubjectName: {
    type: String,
    required: true
  },
  coursesids: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  }],
  SubjectCaption: {
    type: String,
    required: true
  },
  SubjectDesc: {
    type: String,
    required: true
  },
  MasterBranchID: { type: mongoose.Schema.Types.ObjectId, ref: "MasterBranch", required: true }
});

subjectSchema.index({ MasterBranchID: 1 });

const Subject = mongoose.model('Subject', subjectSchema);




// //Start of API routes
// app.get('/api/branches', authenticateToken, async (req, res) => {
//   try {
//     const query = buildBranchQuery(req.user, req.query.branchId);
//     console.log("User:", req.user);
// console.log("Query:", query);
//     const branches = await Branch.find(query).lean();

    
//     res.json(branches);
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// });








app.get('/api/branches', authenticateToken, async (req, res) => {

  try {

    let branches = [];

    console.log("User:", req.user);

    // SuperAdmin → show all branches
    if (
      req.user?.role === "SuperAdmin" ||
      req.user?.roles?.includes("SuperAdmin")
    ) {

      branches = await Branch.find({}).lean();

    } else {

      // Normal users → only their branch
      const query = buildBranchQuery(
        req.user,
        req.query.branchId
      );

      console.log("Query:", query);

      branches = await Branch.find(query).lean();
    }

    console.log("TOTAL BRANCHES:", branches.length);

    res.json(branches);

  } catch (error) {

    console.error("Branch fetch error:", error);

    res.status(500).json({
      message: error.message
    });

  }
});


// app.get("/api/faculties/checkAvailability", async (req, res) => {
//   try {
//     const { facultyId, day, startTime, endTime } = req.query;

//     // Convert times to minutes for easy comparison
//     const convertTimeToMinutes = (timeStr) => {
//       const [time, period] = timeStr.split(' ');
//       let [hours, minutes] = time.split(':').map(Number);

//       if (period === 'PM' && hours < 12) hours += 12;
//       if (period === 'AM' && hours === 12) hours = 0;

//       return hours * 60 + minutes;
//     };

//     const requestStartMinutes = convertTimeToMinutes(startTime);
//     const requestEndMinutes = convertTimeToMinutes(endTime);

//     // Exclude completed batches
//     const facultyBatches = await Batch.find({
//       status: { $nin: ["completed", "complete"] }, // <- ignore finished batches
//       "subject": {
//         $elemMatch: {
//           faculty: facultyId,
//           day: day
//         }
//       }
//     });

//     const hasConflict = facultyBatches.some(batch => {
//       return batch.subject.some(sub => {
//         if (sub.faculty.toString() === facultyId && sub.day === day) {
//           const [existingStart, existingEnd] = sub.timeSlot.split('-');

//           const existingStartMinutes = convertTimeToMinutes(existingStart.trim());
//           const existingEndMinutes = convertTimeToMinutes(existingEnd.trim());

//           return (
//             (requestStartMinutes < existingEndMinutes && requestStartMinutes >= existingStartMinutes) ||
//             (requestEndMinutes > existingStartMinutes && requestEndMinutes <= existingEndMinutes) ||
//             (requestStartMinutes <= existingStartMinutes && requestEndMinutes >= existingEndMinutes)
//           );
//         }
//         return false;
//       });
//     });

//     res.json({ available: !hasConflict });
//   } catch (error) {
//     console.error("Error checking faculty availability:", error);
//     res.status(500).json({ error: "Server error checking availability" });
//   }
// });



app.get("/api/faculties/checkAvailability", async (req, res) => {
  try {
    const { facultyId, day, startTime, endTime } = req.query;
    
    // Convert times to minutes for easy comparison
    const convertTimeToMinutes = (timeStr) => {
      const [time, period] = timeStr.split(' ');
      let [hours, minutes] = time.split(':').map(Number);
      if (period === 'PM' && hours < 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
      return hours * 60 + minutes;
    };
    
    const requestStartMinutes = convertTimeToMinutes(startTime);
    const requestEndMinutes = convertTimeToMinutes(endTime);
    
    // Exclude completed batches
    // Updated to check schedule array instead of direct day/timeSlot
    const facultyBatches = await Batch.find({
      status: { $nin: ["completed", "complete"] },
      "subject": {
        $elemMatch: {
          faculty: facultyId,
          "schedule.day": day // Check if any schedule entry has this day
        }
      }
    });
    
    const hasConflict = facultyBatches.some(batch => {
      return batch.subject.some(sub => {
        if (sub.faculty.toString() === facultyId) {
          // Check each schedule entry for conflicts
          return sub.schedule.some(scheduleItem => {
            if (scheduleItem.day === day) {
              const [existingStart, existingEnd] = scheduleItem.timeSlot.split('-');
              const existingStartMinutes = convertTimeToMinutes(existingStart.trim());
              const existingEndMinutes = convertTimeToMinutes(existingEnd.trim());
              
              // Check for time overlap
              return (
                (requestStartMinutes < existingEndMinutes && requestStartMinutes >= existingStartMinutes) ||
                (requestEndMinutes > existingStartMinutes && requestEndMinutes <= existingEndMinutes) ||
                (requestStartMinutes <= existingStartMinutes && requestEndMinutes >= existingEndMinutes)
              );
            }
            return false;
          });
        }
        return false;
      });
    });
    
    res.json({ available: !hasConflict });
  } catch (error) {
    console.error("Error checking faculty availability:", error);
    res.status(500).json({ error: "Server error checking availability" });
  }
});
// app.get('/api/batches/available', async (req, res) => {
//   try {
//     const { userId } = req.query;
//     console.log("Fetching available batches for user ID:", userId);

//     if (!userId) {
//       return res.status(400).json({ message: 'User ID is required' });
//     }

//     // Step 1: Find the batch where this user is currently assigned
//     const currentBatch = await Batch.findOne({ assignedStudents: userId });

//     if (!currentBatch) {
//       return res.status(404).json({ message: 'User is not assigned to any batch' });
//     }

//     const userBranchId = currentBatch.branchId;

//     // Step 2: Find other batches in the same branch that user is not assigned to
//     const availableBatches = await Batch.find({
//       branchId: userBranchId,
//       _id: { $ne: currentBatch._id }, // exclude current batch
//       assignedStudents: { $ne: userId }, // exclude batches where user is already assigned
//       status: { $in: ['to be start', 'running'] }
//     }).populate('faculty', 'name');

//     res.json(availableBatches);
//   } catch (error) {
//     console.error('Error fetching available batches:', error);
//     res.status(500).json({ message: 'Server error', error: error.message });
//   }
// });


app.get('/api/batches/available', async (req, res) => {
  try {
    const { userId } = req.query;
    console.log("Fetching available batches for user ID:", userId);

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // Step 1: Find the user's registration to get their branchId
    const userRegistration = await Registration.findById(userId);

    if (!userRegistration) {
      return res.status(404).json({ message: 'User registration not found' });
    }

    const userBranchId = userRegistration.branchId;

    // Step 2: Find batches in the same branch that user is not assigned to
    const availableBatches = await Batch.find({
      branchId: userBranchId,
      assignedStudents: { $ne: userId }, // exclude batches where user is already assigned
      status: { $in: ['to be start', 'running'] }
    }).populate('faculty', 'name');

    res.json(availableBatches);
  } catch (error) {
    console.error('Error fetching available batches:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
app.get('/api/branches/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let branch = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      branch = await Branch.findById(id);
    }

    if (!branch) {
      branch = await Branch.findOne({ branchId: id });
    }

    if (!branch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    res.status(200).json(branch);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/batch-interests', async (req, res) => {
  try {
    const batchInterests = await BatchInterest.find()
      .populate('userId', 'name email')
      .populate('courseDetails.courseTypeId', 'name')
      .populate('courseDetails.courseId', 'name')
      .populate('courseDetails.selectedSubjects', 'name')
      .sort({ createdAt: -1 }); // Sort by createdAt in descending order (newest first)

    res.status(200).json({
      success: true,
      count: batchInterests.length,
      data: batchInterests
    });
  } catch (error) {
    console.error('Error fetching batch interests:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});
app.get('/api/batches/check-interest', async (req, res) => {
  try {
    const { userId, batchId } = req.query;

    // Validate required fields
    if (!userId || !batchId) {
      return res.status(400).json({ success: false, message: 'User ID and Batch ID are required' });
    }

    // Validate ID formats
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format' });
    }

    if (!mongoose.Types.ObjectId.isValid(batchId)) {
      return res.status(400).json({ success: false, message: 'Invalid batch ID format' });
    }

    // Check if interest record exists
    const existingInterest = await BatchInterest.findOne({ userId, batchId });

    return res.status(200).json({
      success: true,
      exists: existingInterest ? true : false
    });
  } catch (error) {
    console.error('Error checking batch interest:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});
// Create a new branch
app.post('/api/branches', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    // Check if branch with this ID already exists
    const existingBranch = await Branch.findOne({ branchId: req.body.branchId });
    if (existingBranch) {
      return res.status(400).json({ message: 'Branch with this ID already exists' });
    }

    const branch = new Branch({
      branchId: req.body.branchId,
      branchName: req.body.branchName,
      location: req.body.location,
      fulladdress: req.body.fulladdress,
    });

    const newBranch = await branch.save();
    res.status(201).json(newBranch);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update a branch
app.put('/api/branches/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const updatedBranch = await Branch.findByIdAndUpdate(
      req.params.id,
      {
        branchName: req.body.branchName,
        location: req.body.location,
        branchId: req.body.branchId,
        fulladdress: req.body.fulladdress,
        email: req.body.email,
        phone: req.body.phone,
      },
      { new: true }
    );

    if (!updatedBranch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    res.status(200).json(updatedBranch);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.patch('/api/batches/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ message: 'Status is required' });
    }

    // Find and update just the status field
    const updatedBatch = await Batch.findByIdAndUpdate(
      id,
      { status },
      { new: true } // Return the updated document
    );

    if (!updatedBatch) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    res.status(200).json(updatedBatch);
  } catch (error) {
    console.error('Error updating batch status:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
// Delete a branch
app.delete('/api/branches/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const branch = await Branch.findById(req.params.id);
    if (!branch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    await Faculty.deleteMany({
      branchId: branch.branchId,
      role: { $in: ["SubAdmin", "BranchAdmin"] },
    });

    await branch.deleteOne();

    res.status(200).json({ message: 'Branch and assigned sub-admin(s) deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// SUPER_ADMIN: Create Branch + SUB_ADMIN (branch-mapped) in one call
app.post("/api/superadmin/create-branch", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const {
      branchName,
      branchId,
      location,
      fulladdress,
      subAdminName,
      subAdminEmail,
      password,
      status,
    } = req.body || {};

    if (!branchName || !branchId || !location || !subAdminName || !subAdminEmail || !password) {
      return res.status(400).json({ message: "All required fields must be provided" });
    }

    const finalBranchId = String(branchId).trim();
    const finalBranchName = String(branchName).trim();

    const existingBranch = await Branch.findOne({
      $or: [{ branchId: finalBranchId }, { branchName: finalBranchName }],
    }).lean();
    if (existingBranch) {
      return res.status(400).json({ message: "Unique branch name/code required" });
    }

    const normalizedEmail = String(subAdminEmail).toLowerCase().trim();
    const existingSubAdmin = await Faculty.findOne({ email: normalizedEmail }).lean();
    if (existingSubAdmin) {
      return res.status(400).json({ message: "Sub-Admin email already exists" });
    }

    const hashedPassword = await bcrypt.hash(String(password), 10);

    const createdBranch = await Branch.create({
      branchId: finalBranchId,
      branchName: finalBranchName,
      location: String(location).trim(),
      fulladdress: String(fulladdress || "").trim(),
    });

    const createdSubAdmin = await Faculty.create({
      firstName: String(subAdminName).trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: ["SubAdmin", "BranchAdmin"],
      status: status || "Active",
      branchId: createdBranch.branchId,
    });

    return res.status(201).json({
      message: "Created branch + sub-admin",
      branch: createdBranch,
      subAdmin: {
        _id: createdSubAdmin._id,
        email: createdSubAdmin.email,
        branchId: createdSubAdmin.branchId,
      },
    });
  } catch (error) {
    console.error("Error in /api/superadmin/create-branch:", error);
    return res.status(500).json({ 
      message: "Server error", 
      error: error.message,
      validationErrors: error.errors ? Object.keys(error.errors).map(key => ({ field: key, message: error.errors[key].message })) : null
    });
  }
});


app.post("/api/assign-batch", async (req, res) => {
  const { studentId, batchId } = req.body;

  try {
    const batch = await Batch.findById(batchId);
    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    // Check if the batch has available slots
    if (batch.remainingStudentCount > 0) {
      // Add student to the batch
      batch.assignedStudents.push(studentId);
      batch.remainingStudentCount -= 1;
      await batch.save();

      // Optionally, update the student's batch field if necessary
      await Registration.findByIdAndUpdate(studentId, { batch: batchId });

      return res.json({ message: "Batch assigned successfully!", batch });
    } else {
      return res.status(400).json({ error: "No remaining slots in this batch" });
    }
  } catch (error) {
    console.error("Error assigning batch", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/batches/:batchId", async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);

    if (!batch) {
      return res.status(404).json({ message: "Batch not found" });
    }

    // Ensure assignedStudents is always an array
    batch.assignedStudents = batch.assignedStudents || [];

    res.json(batch);
  } catch (error) {
    console.error("Error fetching batch:", error);
    res.status(500).json({ message: "Server error" });
  }
});

const documentFields = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'offerLetter', maxCount: 1 },
  { name: 'idProof', maxCount: 1 },
  { name: 'addressProof', maxCount: 1 },
  { name: 'educationCertificates', maxCount: 1 },
  { name: 'bankDetails', maxCount: 1 }
]);

// Endpoint to upload documents for an existing faculty
app.post("/api/faculties/:id/documents", documentFields, async (req, res) => {
  try {
    const facultyId = req.params.id;
    const files = req.files;

    if (!files || Object.keys(files).length === 0) {
      return res.status(400).json({ message: "No files were uploaded" });
    }

    const faculty = await Faculty.findById(facultyId);
    if (!faculty) {
      return res.status(404).json({ message: "Faculty not found" });
    }

    // Initialize documents object if it doesn't exist
    if (!faculty.documents) {
      faculty.documents = {};
    }

    // Process each uploaded file
    Object.keys(files).forEach(fieldName => {
      const file = files[fieldName][0];
      faculty.documents[fieldName] = {
        filename: file.originalname,
        path: file.path,
        contentType: file.mimetype,
        uploadDate: new Date()
      };
    });

    await faculty.save();
    res.status(200).json({
      message: "Documents uploaded successfully",
      documents: faculty.documents
    });
  } catch (error) {
    console.error("Error uploading documents:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Endpoint to download a specific document
app.get("/api/faculties/:id/documents/:docType/download", async (req, res) => {
  try {
    const { id, docType } = req.params;

    const faculty = await Faculty.findById(id);
    if (!faculty || !faculty.documents || !faculty.documents[docType]) {
      return res.status(404).json({ message: "Document not found" });
    }

    const document = faculty.documents[docType];

    // Resolve the file path properly (important for Windows paths with backslashes)
    const filePath = path.resolve(document.path);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found on server" });
    }

    // Set headers for download
    res.set({
      'Content-Type': document.contentType,
      'Content-Disposition': `attachment; filename="${document.filename}"` // 'attachment' forces download
    });

    // Stream the file to the response
    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (err) => {
      console.error("Error streaming file:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error streaming file" });
      }
    });

    fileStream.pipe(res);
  } catch (error) {
    console.error("Error downloading document:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Endpoint to update a specific document
app.put("/api/faculties/:id/documents/:docType", upload.single('document'), async (req, res) => {
  try {
    const { id, docType } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "No file was uploaded" });
    }

    const faculty = await Faculty.findById(id);
    if (!faculty) {
      return res.status(404).json({ message: "Faculty not found" });
    }

    // Check if the document already exists to delete old file
    if (faculty.documents && faculty.documents[docType] && faculty.documents[docType].path) {
      const oldFilePath = path.join(process.cwd(), faculty.documents[docType].path);
      // const oldFilePath = path.join(__dirname, faculty.documents[docType].path);
      console.log("Old file path:", oldFilePath);
      // Delete the old file if it exists
      try {
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
          console.log(`Deleted old file: ${oldFilePath}`);
        }
      } catch (err) {
        console.error(`Error deleting old file: ${err}`);
        // Continue with the update even if file deletion fails
      }
    }

    // Initialize documents object if it doesn't exist
    if (!faculty.documents) {
      faculty.documents = {};
    }

    // Store relative path instead of absolute path
    const relativePath = file.path.replace(/^.*[\\\/]uploads[\\\/]/, 'uploads/');

    // Update the document
    faculty.documents[docType] = {
      filename: file.originalname,
      path: file.path,
      contentType: file.mimetype,
      uploadDate: new Date()
    };

    await faculty.save();
    res.status(200).json({
      message: `Document ${docType} updated successfully`,
      document: faculty.documents[docType]
    });
  } catch (error) {
    console.error("Error updating document:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// app.get("/api/faculties/:id/documents/:docType", async (req, res) => {
//   try {
//     const { id, docType } = req.params;
//     console.log("hello")
//     const faculty = await Faculty.findById(id);
//     if (!faculty || !faculty.documents || !faculty.documents[docType]) {
//       return res.status(404).json({ message: "Document not found" });
//     }

//     const document = faculty.documents[docType];

//     res.set({
//       'Content-Type': document.contentType,
//       'Content-Disposition': `inline; filename="${document.filename}"`
//     });
//     if (!document.path || !res) {
//       return res.status(404).json({ message: "Document not found" });
//     }
//     const fileStream = fs.createReadStream(document.path);
//     fileStream.pipe(res);
//   } catch (error) {
//     console.error("Error fetching document:", error);
//     res.status(500).json({ error: "Internal Server Error" });
//   }
// });

app.get("/api/faculties/:id/documents/:docType", async (req, res) => {
  try {
    const { id, docType } = req.params;
    const faculty = await Faculty.findById(id);

    if (!faculty || !faculty.documents || !faculty.documents[docType]) {
      return res.status(404).json({ message: "Document metadata not found" });
    }

    const document = faculty.documents[docType];
    const filePath = path.resolve(document.path); // normalize to absolute path

    // Check if file exists before attempting to stream
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "Document file not found on server" });
    }

    res.set({
      'Content-Type': document.contentType,
      'Content-Disposition': `inline; filename="${document.filename}"`,
    });

    const fileStream = fs.createReadStream(filePath);

    // Handle stream errors to avoid crashing the app
    fileStream.on('error', (err) => {
      console.error("Stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error reading the document file" });
      }
    });

    fileStream.pipe(res);
  } catch (error) {
    console.error("Error fetching document:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get('/api/Faculty/check-email-exists', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required' });
    }

    // Check your database for the email
    const existingUser = await Faculty.findOne({ email: email });

    // Return response indicating if email exists
    return res.json({
      exists: !!existingUser,
      message: existingUser ? 'Email already registered' : 'Email is available'
    });

  } catch (error) {
    console.error('Error checking email existence:', error);
    return res.status(500).json({
      error: 'Server error while checking email',
      exists: false
    });
  }
});
// Update the POST endpoint
// app.post("/api/faculties", upload12.single('profilePhoto'), async (req, res) => {
//   try {
//     console.log("Received Faculty Data:", req.body);

//     // Extract password and other data from the request
//     let { email, password, branches, employeeId, ...otherData } = req.body;
//     const plainPassword = req.body.password;

//     // Parse JSON strings for arrays
//     if (typeof otherData.role === 'string') {
//       try {
//         otherData.role = JSON.parse(otherData.role);
//       } catch (e) {
//         // If it's not valid JSON, keep it as is
//       }
//     }

//     if (typeof otherData.subjects === 'string') {
//       try {
//         otherData.subjects = JSON.parse(otherData.subjects);
//       } catch (e) {
//         // If it's not valid JSON, keep it as is
//       }
//     }

//     const existingFaculty = await Faculty.findOne({ email });

//     if (existingFaculty) {
//       // Delete the uploaded file if faculty creation fails
//       if (req.file) {
//         fs.unlinkSync(req.file.path);
//       }
//       return res.status(400).json({ message: "Email already exists" });
//     }

//     // Hash the password before saving
//     if (password) {
//       const saltRounds = 10;
//       const hashedPassword = await bcrypt.hash(password, saltRounds);
//       password = hashedPassword;
//     }

//     const branchId = branches;

//     // Add profile photo path if a file was uploaded
//     let profilePhoto = null;
//     if (req.file) {
//       profilePhoto = `profile/${req.file.filename}`;
//     }

//     // Create new faculty with all data
//     const faculty = new Faculty({
//       ...otherData,
//       email,
//       password,
//       branchId,
//       employeeId,
//       profilePhoto
//     });

//     // Save to database
//     await faculty.save();

//     await sendWelcomeEmail(email, plainPassword, otherData.name || 'Faculty Member');
//     res.status(201).json({ message: "Faculty added successfully", faculty });
//   } catch (error) {
//     console.error("Error saving faculty:", error);

//     // Delete the uploaded file if faculty creation fails
//     if (req.file) {
//       fs.unlinkSync(req.file.path);
//     }

//     res.status(500).json({ error: "Internal Server Error" });
//   }
// });
app.post(
  "/api/faculties",
  authenticateToken,
  requireSuperAdmin,
  upload12.single("profilePhoto"),
  async (req, res) => {
  try {
    console.log("Received Faculty Data:", req.body);

    // Extract password and other data from the request
    let { email, password, branches, employeeId, ...otherData } = req.body;
    const plainPassword = req.body.password;

    // Parse JSON strings for arrays
    if (typeof otherData.role === 'string') {
      try {
        otherData.role = JSON.parse(otherData.role);
      } catch (e) {
        // If it's not valid JSON, keep it as is
      }
    }

    if (typeof otherData.subjects === 'string') {
      try {
        otherData.subjects = JSON.parse(otherData.subjects);
      } catch (e) {
        // If it's not valid JSON, keep it as is
      }
    }

    const existingFaculty = await Faculty.findOne({ email });

    if (existingFaculty) {
      // Delete the uploaded file if faculty creation fails
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ message: "Email already exists" });
    }

    // Hash the password before saving
    if (password) {
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      password = hashedPassword;
    }

    const branchId = branches;

    // Add profile photo path if a file was uploaded
    let profilePhoto = null;
    if (req.file) {
      profilePhoto = `profile/${req.file.filename}`;
    }

    // Create new faculty with all data
    const faculty = new Faculty({
      ...otherData,
      email,
      password,
      branchId,
      employeeId,
      profilePhoto
    });

    // Save to database
    await faculty.save();
    console.log("Faculty saved successfully, now sending email...");

    // Send welcome email - FIXED: Added proper error handling and validation
    if (email && plainPassword && (otherData.name || otherData.firstName)) {
      try {
        console.log("Attempting to send welcome email...");
        await sendWelcomeEmail(email, plainPassword, otherData.name || otherData.firstName || 'Faculty Member');
        console.log('Welcome email sent successfully');
      } catch (emailError) {
        console.error('Failed to send welcome email:', emailError);
        // Don't fail the entire request if email fails, but log the specific error
        console.error('Email error details:', {
          message: emailError.message,
          code: emailError.code,
          command: emailError.command
        });
      }
    } else {
      console.log('Email not sent - missing required data:', {
        email: !!email,
        plainPassword: !!plainPassword,
        name: !!(otherData.name || otherData.firstName)
      });
    }

    res.status(201).json({ message: "Faculty added successfully", faculty });
  } catch (error) {
    console.error("Error saving faculty:", error);

    // Delete the uploaded file if faculty creation fails
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ error: "Internal Server Error" });
  }
  },
);

async function sendWelcomeEmail(email, password, name) {
  console.log('=== EMAIL SENDING START ===');
  console.log('Email:', email);
  console.log('Name:', name);
  console.log('Password length:', password ? password.length : 'No password');
  
  // Validate inputs
  if (!email || !password || !name) {
    throw new Error('Missing required email parameters');
  }

  // FIXED: Updated SMTP configuration
  const transporter = nodemailer.createTransport({
    host: 'smtp.hostinger.com',
    port: 587,
    secure: false, // Use STARTTLS
    auth: {
      user: 'info@jbkacademy.in',
      pass: 'Karthik@9581766526', // Consider using environment variables for credentials
    },
    tls: {
      rejectUnauthorized: false
    },
    connectionTimeout: 60000, // 60 seconds
    greetingTimeout: 30000, // 30 seconds
    socketTimeout: 60000, // 60 seconds
    logger: true,
    debug: true
  });

  // Test the connection first
  try {
    console.log('Testing SMTP connection...');
    await transporter.verify();
    console.log('✓ SMTP connection verified successfully');
  } catch (verifyError) {
    console.error('✗ SMTP verification failed:', verifyError);
    throw new Error(`SMTP connection failed: ${verifyError.message}`);
  }

  // FIXED: Simplified email content
  const mailOptions = {
    from: '"JBK Academy" <info@jbkacademy.in>',
    to: email,
    subject: 'Welcome to JBK Academy - Faculty Portal Access',
    html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Welcome to JBK Academy</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4299e1; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .credentials { background: white; padding: 15px; border-left: 4px solid #4299e1; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Welcome to JBK Academy</h1>
        </div>
        <div class="content">
          <h2>Hello ${name}!</h2>
          <p>Your faculty account has been created successfully.</p>
          <div class="credentials">
            <h3>Login Credentials:</h3>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Password:</strong> ${password}</p>
          </div>
        
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} JBK Academy. All rights reserved.</p>
          <p>Visit: <a href="https://www.jbkacademy.in">www.jbkacademy.in</a></p>
        </div>
         <div style="text-align: center; margin: 25px 0; padding-top: 20px; border-top: 1px solid #34495e;">
          <p style="margin-bottom: 15px; font-size: 14px; color: #bdc3c7; font-weight: 300; letter-spacing: 0.5px;">
            CONNECT WITH US
          </p>
          <div>
            <a href="https://m.facebook.com/p/JBK-Academy-Hyderabad" target="_blank" style="text-decoration: none; margin: 0 12px; display: inline-block;">
              <div style="width: 40px; height: 40px; background-color: #3b5998; border-radius: 50%; display: inline-block; line-height: 40px; text-align: center;">
                <span style="color: #ffffff; font-size: 18px; font-weight: bold;">f</span>
              </div>
            </a>
            <a href="https://www.instagram.com/jbk_academy/?hl=en" target="_blank" style="text-decoration: none; margin: 0 10px; display: inline-block;">
              <div style="width: 40px; height: 40px; background: linear-gradient(45deg, #f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%); border-radius: 50%; display: inline-block; line-height: 40px; text-align: center;">
                <span style="color: #ffffff; font-size: 16px; font-weight: bold;">Insta</span>
              </div>
            </a>
            <a href="https://www.linkedin.com/company/jbk-academy" target="_blank" style="text-decoration: none; margin: 0 12px; display: inline-block;">
              <div style="width: 40px; height: 40px; background-color: #0077b5; border-radius: 50%; display: inline-block; line-height: 40px; text-align: center;">
                <span style="color: #ffffff; font-size: 16px; font-weight: bold;">in</span>
              </div>
            </a>
            <a href="https://m.youtube.com/channel/UCSxp1XWEBEfWDhsiUCGYJ7A" target="_blank" style="text-decoration: none; margin: 0 12px; display: inline-block;">
              <div style="width: 40px; height: 40px; background-color: #ff0000; border-radius: 50%; display: inline-block; line-height: 40px; text-align: center;">
                <span style="color: #ffffff; font-size: 14px; font-weight: bold;">▶</span>
              </div>
            </a>
            <a href="https://wa.me/919985023100" target="_blank" style="text-decoration: none; margin: 0 12px; display: inline-block;">
              <div style="width: 40px; height: 40px; background-color: #25d366; border-radius: 50%; display: inline-block; line-height: 40px; text-align: center;">
                <span style="color: #ffffff; font-size: 16px; font-weight: bold;">W</span>
              </div>
            </a>
          </div>
        </div>
      </div>
    </body>
    </html>
    `
  };

  try {
    console.log('Sending email...');
    console.log('Mail options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject
    });
    
    const info = await transporter.sendMail(mailOptions);
    console.log('✓ Email sent successfully:', info.messageId);
    console.log('Email info:', info);
    console.log('=== EMAIL SENDING END ===');
    return info;
  } catch (error) {
    console.error('✗ Error sending email:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response
    });
    console.log('=== EMAIL SENDING END (ERROR) ===');
    throw error;
  }
}

// Add this new endpoint to get a single faculty by ID
app.get("/api/faculties/:userId", authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId;

    // Find faculty by ID
    const faculty = await Faculty.findById(userId);

    if (!faculty) {
      return res.status(404).json({
        success: false,
        message: 'Faculty not found'
      });
    }

    if (
      faculty &&
      isSubAdminUser(req.user) &&
      req.user.branchId &&
      faculty.branchId !== req.user.branchId
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied for this branch",
      });
    }

    res.json(faculty);
  } catch (error) {
    console.error('Error fetching faculty:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Update the PUT endpoint
app.put(
  "/api/faculties/:id",
  authenticateToken,
  upload12.single("profilePhoto"),
  async (req, res) => {
  try {
    console.log("Received Faculty Update Data:", req.body);
    // Find the existing faculty
    const existingFaculty = await Faculty.findById(req.params.id);
    if (!existingFaculty) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ message: "Faculty not found" });
    }
    
    if (
      isSubAdminUser(req.user) &&
      req.user.branchId &&
      existingFaculty.branchId !== req.user.branchId
    ) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(403).json({ message: "Access denied for this branch" });
    }

    // Parse data from the request body
    let updateData = {...req.body};
    console.log("facultyupdate", req.body);
    
    // Handle the branch ID field name mismatch
    if (updateData.branches) {
      // Map the "branches" field from the request to "branchId" in the database
      updateData.branchId = updateData.branches;
      delete updateData.branches; // Remove the original field to avoid duplication
    }
    
    if (!updateData.MasterBranchID || updateData.MasterBranchID === 'undefined') {
      // Do not update or overwrite existing MasterBranchID
      delete updateData.MasterBranchID;
    }
   
    // Parse JSON strings for arrays
    if (typeof updateData.role === 'string') {
      try {
        updateData.role = JSON.parse(updateData.role);
      } catch (e) {
        // If it's not valid JSON, keep it as is
      }
    }
   
    if (typeof updateData.subjects === 'string') {
      try {
        updateData.subjects = JSON.parse(updateData.subjects);
      } catch (e) {
        // If it's not valid JSON, keep it as is
      }
    }
    
    // Handle profile photo
    if (req.file) {
      // Delete the old photo if it exists
      if (existingFaculty.profilePhoto) {
        const oldPhotoPath = path.join(__dirname, existingFaculty.profilePhoto);
        if (fs.existsSync(oldPhotoPath)) {
          fs.unlinkSync(oldPhotoPath);
        }
      }
     
      // Update with the new photo path
      updateData.profilePhoto = `profile/${req.file.filename}`;
    }
   
    // If there's a password in the request and it's different from the stored one, hash it
    if (updateData.password && updateData.password.trim() !== '') {
      const saltRounds = 10;
      updateData.password = await bcrypt.hash(updateData.password, saltRounds);
    } else {
      // Don't update password if it's blank
      delete updateData.password;
    }
    
    if (isSubAdminUser(req.user)) {
      // Sub-admins are hard-bound to their own branch
      updateData.branchId = existingFaculty.branchId;
      delete updateData.branches;
    }

    // Update the faculty
    const faculty = await Faculty.findByIdAndUpdate(req.params.id, updateData, { new: true });
   
    res.json({ message: "Faculty updated successfully", faculty });
  } catch (error) {
    console.error("Error updating faculty:", error);
   
    // Delete the uploaded file if update fails
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
   
    res.status(500).json({ error: "Internal Server Error" });
  }
  },
);
// app.get("/api/faculties", async (req, res) => {
//   const faculties = await Faculty.find();
//   res.json(faculties);
// });


//new
// app.get("/api/faculties", authenticateToken, async (req, res) => {
//   try {
//     const query = buildBranchQuery(req.user, req.query.branchId);
//     if (req.query.status) query.status = req.query.status;

//     const all = String(req.query.all) === 'true';
//     const page = Math.max(Number(req.query.page) || 1, 1);
//     const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
//     const skip = (page - 1) * limit;

//     const baseQuery = Faculty.find(query)
// .select(`
//   firstName
//   lastName
//   email
//   phone
//   employeeId
//   experience
//   joinDate
//   role
//   status
//   branchId
//   department
//   MasterBranchID
//   createdAt
//   updatedAt
//   subjects
//   assignedEnquiries
//   Feedbacks
// `)      .sort({ createdAt: -1 })
//       .lean();

//     if (!all) baseQuery.skip(skip).limit(limit);

//     const [faculties, total] = await Promise.all([
//       baseQuery,
//       Faculty.countDocuments(query),
//     ]);

//     res.json({ total, page, limit: all ? total : limit, faculties });
//   } catch (error) {
//     console.error("Error fetching faculties:", error);
//     res.status(500).json({ error: "Failed to fetch faculties" });
//   }
// });


//old api
// app.get("/api/faculties", async (req, res) => {
//   try {
//     const { branchId } = req.query;

//     let faculties;
//     if (branchId) {
//       // If branchId is provided, filter by branch
//       faculties = await Faculty.find({ branchId });
//     } else {
//       // Otherwise return all faculties
//       faculties = await Faculty.find();
//     }

//     res.json(faculties);
//   } catch (error) {
//     console.error("Error fetching faculties:", error);
//     res.status(500).json({ error: "Failed to fetch faculties" });
//   }
// });
app.get("/api/faculties", async (req, res) => {
  try {
    const { branchId } = req.query;

    let filter = {};

    if (branchId) {
      filter.branchId = branchId;
    }

    const faculties = await Faculty.find(filter)
      .select('-Feedbacks -followUps -assignedEnquiries -documents -password -resetCode')
      .lean();

    res.json(faculties);

  } catch (error) {
    console.error("Error fetching faculties:", error);

    res.status(500).json({
      error: "Failed to fetch faculties"
    });
  }
});







app.delete("/api/faculties/:id", authenticateToken, async (req, res) => {
  const faculty = await Faculty.findById(req.params.id);
  if (!faculty) {
    return res.status(404).json({ message: "Faculty not found" });
  }

  if (
    isSubAdminUser(req.user) &&
    req.user.branchId &&
    faculty.branchId !== req.user.branchId
  ) {
    return res.status(403).json({ message: "Access denied for this branch" });
  }

  await Faculty.findByIdAndDelete(req.params.id);
  res.json({ message: "Faculty deleted" });
});

app.get("/api/faculty-by-subject/:subjectCode", async (req, res) => {
  try {
    const { subjectCode } = req.params;
    const facultyList = await Faculty.find({ "subjects.subjectCode": subjectCode });
    res.json(facultyList);
  } catch (error) {
    res.status(500).json({ message: "Error fetching faculty", error });
  }
});

// Get Scheduled Assignments
app.get("/api/schedule", async (req, res) => {
  try {
    const schedule = await BatchSchedule.find().populate("faculty").populate("subject");
    res.json(schedule);
  } catch (error) {
    res.status(500).json({ message: "Error fetching schedule", error });
  }
});

app.get("/api/new/batches", async (req, res) => {
  console.time("GET /api/new/batches");
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 0, 0);
    const options = {};

    if (limit > 0) {
      options.limit = Math.min(limit, 100);
      options.skip = (page - 1) * limit;
    }

    const batches = await Batch.find({}, null, options)
      .populate("faculty", "firstName lastName")
      .populate("subject.faculty", "firstName lastName")
      .populate("MasterBranchID", "MasterBranchName")
      .lean();

    const branchIds = [...new Set(batches.map(batch => batch.branchId).filter(Boolean))];
    const subjectIds = [...new Set(batches.flatMap(batch => (batch.subject || []).map(sub => sub.subject)).filter(Boolean))];

    const [branches, subjects] = await Promise.all([
      branchIds.length ? Branch.find({ branchId: { $in: branchIds } }).lean() : [],
      subjectIds.length ? Subject.find({ SubjectId: { $in: subjectIds } }).lean() : []
    ]);

    const branchNameMap = new Map(branches.map(branch => [branch.branchId, branch.branchName]));
    const subjectNameMap = new Map(subjects.map(subject => [subject.SubjectId, subject.SubjectName]));

    const formattedBatches = batches.map(batch => {
      const formatted = {
        ...batch,
        MasterBranchID: batch.MasterBranchID ? batch.MasterBranchID._id : undefined,
        masterBranchName: batch.MasterBranchID ? batch.MasterBranchID.MasterBranchName : undefined,
        branchName: branchNameMap.get(batch.branchId) || undefined,
        facultyName: batch.faculty ? `${batch.faculty.firstName} ${batch.faculty.lastName}` : undefined,
      };

      formatted.subject = (batch.subject || []).map(sub => ({
        ...sub,
        subjectName: subjectNameMap.get(sub.subject) || "Unknown Subject",
        facultyName: sub.faculty
          ? `${sub.faculty.firstName} ${sub.faculty.lastName}`
          : "Not assigned"
      }));

      return formatted;
    });

    res.json(formattedBatches);
  } catch (error) {
    console.error("Error fetching batches:", error);
    res.status(500).json({ error: "Failed to fetch batches" });
  } finally {
    console.timeEnd("GET /api/new/batches");
  }
});

app.get("/api/subjects/branch/:branchId", async (req, res) => {
  try {
    const subjects = await Subject.find({ branchId: req.params.branchId });
    res.json(subjects);
  } catch (error) {
    console.error("Error fetching subjects:", error);
    res.status(500).json({ error: "Failed to fetch subjects" });
  }
});

app.get("/api/faculties/branch/:branchId/subject", async (req, res) => {
  try {
    const branchId = req.params.branchId;
    // Get the subject code from query parameter instead of URL param
    const subjectCode = req.query.subjectCode;
    console.log("Received request for faculties with branchId:", branchId, "and subjectCode:", subjectCode);

    console.log(`Finding faculties for branch ${branchId} and subject ${subjectCode}`);

    const faculties = await Faculty.find({
      branchId: branchId,
      "subjects.subjectCode": subjectCode
    });

    res.json(faculties || []);
  } catch (error) {
    console.error("Error fetching faculties:", error);
    res.status(500).json({ error: "Failed to fetch faculties" });
  }
});

// app.put("/api/batches/:id", async (req, res) => {
//   try {
//     const batchData = req.body;
//     console.log("Batch Data for update:", batchData);

//     // Map selectedMasterBranch to MasterBranchID
//     if (batchData.selectedMasterBranch) {
//       batchData.MasterBranchID = batchData.selectedMasterBranch;
//       delete batchData.selectedMasterBranch; // optional: clean up input
//     }
// // Optional validation in backend
//  if (batchData.assignedStudents) {
//       // Validate that all student IDs exist (optional validation)
//       // You can add validation here if needed
//       batchData.assignedStudents = Array.isArray(batchData.assignedStudents) 
//         ? batchData.assignedStudents 
//         : [];
//     }
    
//     // Check for batch ID uniqueness
//     if (batchData.batchId) {
//       const existingBatch = await Batch.findOne({
//         batchId: batchData.batchId,
//         _id: { $ne: req.params.id }
//       });

//       if (existingBatch) {
//         return res.status(400).json({ error: "Batch ID already exists" });
//       }
//     }

//     // Update batch
//     const updatedBatch = await Batch.findByIdAndUpdate(
//       req.params.id,
//       batchData,
//       { new: true }
//     );

//     if (!updatedBatch) {
//       return res.status(404).json({ error: "Batch not found" });
//     }

//     res.json(updatedBatch);
//   } catch (error) {
//     console.error("Error updating batch:", error);
//     res.status(500).json({ error: "Failed to update batch" });
//   }
// });
// Delete batch






// app.put("/api/batches/:id", async (req, res) => {
//   try {
//     const batchData = req.body;
//     console.log("Batch Data for update:", batchData);

//     // Map selectedMasterBranch to MasterBranchID
//     if (batchData.selectedMasterBranch) {
//       batchData.MasterBranchID = batchData.selectedMasterBranch;
//       delete batchData.selectedMasterBranch;
//     }

//     // Handle subject array - clean up empty faculty fields and add missing hoursPerDay
//     if (batchData.subject && Array.isArray(batchData.subject)) {
//       batchData.subject = batchData.subject.map(subj => {
//         let cleanedSubject = { ...subj };
        
//         // Handle empty faculty field - remove it or set to null
//         if (cleanedSubject.faculty === '') {
//           delete cleanedSubject.faculty; // Remove empty faculty field
//           // OR set to null: cleanedSubject.faculty = null;
//         }
        
//         // Handle schedule array - ensure hoursPerDay is present
//         if (cleanedSubject.schedule && Array.isArray(cleanedSubject.schedule)) {
//           cleanedSubject.schedule = cleanedSubject.schedule.map(scheduleItem => {
//             // Add hoursPerDay if missing
//             if (!scheduleItem.hoursPerDay) {
//               return {
//                 ...scheduleItem,
//                 hoursPerDay: 1 // default 1 hour per day
//               };
//             }
//             return scheduleItem;
//           });
//         }
        
//         return cleanedSubject;
//       });
//     }

//     // Handle assigned students - ensure it's an array
//     if (batchData.assignedStudents !== undefined) {
//       batchData.assignedStudents = Array.isArray(batchData.assignedStudents)
//         ? batchData.assignedStudents
//         : [];
        
//       console.log("Updating assigned students:", batchData.assignedStudents);
      
//       // Optional: Validate that student IDs exist in Registration collection
//       if (batchData.assignedStudents.length > 0) {
//         const validStudents = await Registration.find({
//           _id: { $in: batchData.assignedStudents }
//         }).select('_id');
        
//         const validStudentIds = validStudents.map(s => s._id.toString());
//         const invalidStudents = batchData.assignedStudents.filter(
//           id => !validStudentIds.includes(id)
//         );
        
//         if (invalidStudents.length > 0) {
//           console.warn("Invalid student IDs found:", invalidStudents);
//           batchData.assignedStudents = batchData.assignedStudents.filter(
//             id => validStudentIds.includes(id)
//           );
//         }
//       }
//     }

//     // Check for batch ID uniqueness
//     if (batchData.batchId) {
//       const existingBatch = await Batch.findOne({
//         batchId: batchData.batchId,
//         _id: { $ne: req.params.id }
//       });
      
//       if (existingBatch) {
//         return res.status(400).json({ error: "Batch ID already exists" });
//       }
//     }

//     // Create update object with only the fields that are being sent
//     const updateData = {};
    
//     // Only include fields that are actually being updated
//     Object.keys(batchData).forEach(key => {
//       if (batchData[key] !== undefined) {
//         updateData[key] = batchData[key];
//       }
//     });

//     // Update the batch
//     const updatedBatch = await Batch.findByIdAndUpdate(
//       req.params.id,
//       updateData,
//       { new: true, runValidators: true }
//     ).populate('assignedStudents', 'fName lName regid email');

//     if (!updatedBatch) {
//       return res.status(404).json({ error: "Batch not found" });
//     }

//     console.log("Batch updated successfully:", {
//       batchId: updatedBatch.batchId,
//       assignedStudentsCount: updatedBatch.assignedStudents.length
//     });

//     res.json({
//       success: true,
//       message: "Batch updated successfully",
//       batch: updatedBatch
//     });
    
//   } catch (error) {
//     console.error("Error updating batch:", error);
//     res.status(500).json({
//       error: "Failed to update batch",
//       message: error.message
//     });
//   }
// });

app.put("/api/batches/:id", async (req, res) => {
  try {
    const batchData = req.body;
    console.log("Batch Data for update:", batchData);

    // Map selectedMasterBranch to MasterBranchID
    if (batchData.selectedMasterBranch) {
      batchData.MasterBranchID = batchData.selectedMasterBranch;
      delete batchData.selectedMasterBranch;
    }

    // Clean up subject array
    if (batchData.subject && Array.isArray(batchData.subject)) {
      batchData.subject = batchData.subject.map(subj => {
        let cleanedSubject = { ...subj };

        // Remove empty faculty
        if (cleanedSubject.faculty === '') {
          delete cleanedSubject.faculty;
        }

        // Ensure schedule items have hoursPerDay
        if (cleanedSubject.schedule && Array.isArray(cleanedSubject.schedule)) {
          cleanedSubject.schedule = cleanedSubject.schedule.map(item => {
            if (!item.hoursPerDay) {
              return { ...item, hoursPerDay: 1 };
            }
            return item;
          });
        }

        return cleanedSubject;
      });
    }

    // Handle assignedStudents
    if (batchData.assignedStudents !== undefined) {
      batchData.assignedStudents = Array.isArray(batchData.assignedStudents)
        ? batchData.assignedStudents
        : [];

      console.log("Requested assigned students:", batchData.assignedStudents);

      // Validate student IDs
      if (batchData.assignedStudents.length > 0) {
        const validStudents = await Registration.find({
          _id: { $in: batchData.assignedStudents }
        }).select('_id');

        const validIds = validStudents.map(s => s._id.toString());
        const invalidIds = batchData.assignedStudents.filter(id => !validIds.includes(id));

        if (invalidIds.length > 0) {
          console.warn("Invalid student IDs filtered out:", invalidIds);
          batchData.assignedStudents = batchData.assignedStudents.filter(id => validIds.includes(id));
        }
      }

      // ✅ Prevent over-assignment
      if (typeof batchData.studentCount === "number") {
        const assignedCount = batchData.assignedStudents.length;

        if (assignedCount > batchData.studentCount) {
          return res.status(400).json({
            success: false,
            error: `Cannot assign more than ${batchData.studentCount} students`,
          });
        }

        // ✅ Update remainingStudentCount
        const remaining = batchData.studentCount - assignedCount;
        batchData.remainingStudentCount = remaining >= 0 ? remaining : 0;
      }
    }

    // Ensure batchId is unique
    if (batchData.batchId) {
      const existing = await Batch.findOne({
        batchId: batchData.batchId,
        _id: { $ne: req.params.id }
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          error: "Batch ID already exists"
        });
      }
    }

    // Prepare updateData from defined fields
    const updateData = {};
    Object.keys(batchData).forEach(key => {
      if (batchData[key] !== undefined) {
        updateData[key] = batchData[key];
      }
    });

    // Update batch in DB
    const updatedBatch = await Batch.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('assignedStudents', 'fName lName regid email');

    if (!updatedBatch) {
      return res.status(404).json({
        success: false,
        error: "Batch not found"
      });
    }

    console.log("Batch updated:", {
      batchId: updatedBatch.batchId,
      assigned: updatedBatch.assignedStudents.length,
      remaining: updatedBatch.remainingStudentCount
    });

    res.json({
      success: true,
      message: "Batch updated successfully",
      batch: updatedBatch
    });

  } catch (error) {
    console.error("Error updating batch:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update batch",
      message: error.message
    });
  }
});

// New API endpoint specifically for student registration/assignment
app.put("/api/batches/:id/register-students", async (req, res) => {
  try {
    const batchId = req.params.id;
    const { studentIds } = req.body; // Array of student IDs to assign

    console.log("Student registration request for batch:", batchId);
    console.log("Requested student IDs:", studentIds);

    // Validate input
    if (!Array.isArray(studentIds)) {
      return res.status(400).json({
        success: false,
        error: "studentIds must be an array"
      });
    }

    // Find the batch
    const batch = await Batch.findById(batchId);
    if (!batch) {
      return res.status(404).json({
        success: false,
        error: "Batch not found"
      });
    }

    // Validate that all provided student IDs exist
    const validStudents = await Registration.find({
      _id: { $in: studentIds }
    }).select('_id fName lName regid');

    const validIds = validStudents.map(s => s._id.toString());
    const invalidIds = studentIds.filter(id => !validIds.includes(id));

    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Some student IDs are invalid",
        invalidIds: invalidIds
      });
    }

    // Check capacity constraints
    if (studentIds.length > batch.studentCount) {
      return res.status(400).json({
        success: false,
        error: `Cannot assign more than ${batch.studentCount} students. Current limit: ${batch.studentCount}, Requested: ${studentIds.length}`
      });
    }

    // Get current assignments to handle reassignment
    const currentAssignedStudents = batch.assignedStudents || [];
    const currentAssignedIds = currentAssignedStudents.map(id => id.toString());

    console.log("Current assigned students:", currentAssignedIds);
    console.log("New assignment request:", studentIds);

    // Calculate changes
    const studentsToAdd = studentIds.filter(id => !currentAssignedIds.includes(id));
    const studentsToRemove = currentAssignedIds.filter(id => !studentIds.includes(id));

    console.log("Students to add:", studentsToAdd);
    console.log("Students to remove:", studentsToRemove);

    // Update the batch with new assignments
    const assignedCount = studentIds.length;
    const remainingCount = batch.studentCount - assignedCount;

    const updateData = {
      assignedStudents: studentIds,
      remainingStudentCount: remainingCount >= 0 ? remainingCount : 0
    };

    // Update batch in database
    const updatedBatch = await Batch.findByIdAndUpdate(
      batchId,
      updateData,
      { new: true, runValidators: true }
    ).populate('assignedStudents', 'fName lName regid email phone');

    if (!updatedBatch) {
      return res.status(404).json({
        success: false,
        error: "Failed to update batch"
      });
    }

    // Optional: Update student records to track their batch assignments
    // Remove batch assignment from students who were unassigned
    if (studentsToRemove.length > 0) {
      await Registration.updateMany(
        { _id: { $in: studentsToRemove } },
        { $pull: { assignedBatches: batchId } }
      );
    }

    // Add batch assignment to newly assigned students
    if (studentsToAdd.length > 0) {
      await Registration.updateMany(
        { _id: { $in: studentsToAdd } },
        { $addToSet: { assignedBatches: batchId } }
      );
    }

    // Prepare response data
    const responseData = {
      success: true,
      message: "Student registration updated successfully",
      batch: {
        _id: updatedBatch._id,
        batchId: updatedBatch.batchId,
        batchName: updatedBatch.batchName,
        studentCount: updatedBatch.studentCount,
        assignedCount: updatedBatch.assignedStudents.length,
        remainingStudentCount: updatedBatch.remainingStudentCount,
        assignedStudents: updatedBatch.assignedStudents
      },
      changes: {
        added: studentsToAdd.length,
        removed: studentsToRemove.length,
        total: assignedCount
      }
    };

    console.log("Student registration completed:", responseData.changes);

    res.json(responseData);

  } catch (error) {
    console.error("Error in student registration:", error);
    res.status(500).json({
      success: false,
      error: "Failed to register students",
      message: error.message
    });
  }
});

// Additional helper endpoint to get batch registration info
app.get("/api/batches/:id/registration-info", async (req, res) => {
  try {
    const batchId = req.params.id;

    // Find the batch
    const batch = await Batch.findById(batchId)
      .populate('assignedStudents', 'fName lName regid email phone');

    if (!batch) {
      return res.status(404).json({
        success: false,
        error: "Batch not found"
      });
    }

    // Get all students who are eligible for this batch
    // This would depend on your business logic - for now, get all active registrations
    const eligibleStudents = await Registration.find({
      // Add your eligibility criteria here
      // For example: branchId: batch.branchId, status: 'active', etc.
    }).select('fName lName regid email phone assignedBatches');

    // Separate assigned and available students
    const assignedStudents = batch.assignedStudents || [];
    const assignedIds = assignedStudents.map(s => s._id.toString());

    const availableStudents = eligibleStudents.filter(student => 
      !assignedIds.includes(student._id.toString())
    );

    res.json({
      success: true,
      batch: {
        _id: batch._id,
        batchId: batch.batchId,
        batchName: batch.batchName,
        studentCount: batch.studentCount,
        remainingStudentCount: batch.remainingStudentCount
      },
      assignedStudents: assignedStudents,
      availableStudents: availableStudents,
      counts: {
        total: batch.studentCount,
        assigned: assignedStudents.length,
        remaining: batch.remainingStudentCount,
        available: availableStudents.length
      }
    });

  } catch (error) {
    console.error("Error getting batch registration info:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get registration info",
      message: error.message
    });
  }
});
app.delete("/api/batches/:id", async (req, res) => {
  try {
    console.log("Deleting batch with ID:", req.params.id);
    const batch = await Batch.findByIdAndDelete(req.params.id);

    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    res.json({ message: "Batch deleted successfully" });
  } catch (error) {
    console.error("Error deleting batch:", error);
    res.status(500).json({ error: "Failed to delete batch" });
  }
});
// Assign Faculty
app.post("/api/assign-faculty", async (req, res) => {
  try {
    const { batchId, day, timeSlot, subject, faculty } = req.body;
    console.log("Received data:", req.body);
    // Check if faculty is already assigned at the same time
    const conflict = await BatchSchedule.findOne({ day, timeSlot, faculty });

    if (conflict) {
      return res.status(400).json({ message: "Faculty is already assigned at this time slot." });
    }

    const newAssignment = new BatchSchedule({ batchId, day, timeSlot, subject, faculty });
    await newAssignment.save();

    res.status(201).json({ message: "Faculty assigned successfully", data: newAssignment });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
});

app.get("/getCourses", async (req, res) => {
  try {
    const courses = await Course.find().lean();
    res.json(courses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/getBatches", async (req, res) => {
  const batches = await Batch.find();
  res.json(batches);
});


app.get("/getSubjectsByBatch/:batchId", async (req, res) => {
  const batch = await Batch.findOne({ batchId: req.params.batchId });
  if (!batch) return res.status(404).json({ message: "Batch not found" });

  const course = await Course.findOne({ courseCode: batch.course });
  res.json(course ? course.subjects : []);
});

app.get('/api/timetable/batch/:batchId', async (req, res) => {
  try {
    const timetable = await Timetable.find({ batchId: req.params.batchId });
    res.json(timetable);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/getFaculties/:subjectCode", async (req, res) => {
  const faculties = await Faculty.find({ "subjects.subjectCode": req.params.subjectCode });
  res.json(faculties);
});

app.get('/api/timetable/faculty/:facultyId', async (req, res) => {
  try {
    const timetable = await Timetable.find({ 'faculty.employeeId': req.params.facultyId });
    res.json(timetable);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


app.post("/addTimetable", async (req, res) => {
  try {
    let { batchId, schedule, subject, faculty } = req.body;

    // Remove empty schedules (if timeSlot is empty, ignore it)
    schedule = schedule.filter(entry => entry.timeSlot);

    // If all schedules are empty, reject request
    if (schedule.length === 0) {
      return res.status(400).json({ message: "At least one schedule entry must have a time slot!" });
    }

    // Check for batch schedule conflicts (same batch, same day, same time)
    for (let entry of schedule) {
      const existingBatchEntry = await Timetable.findOne({
        batchId: batchId,
        "schedule": {
          $elemMatch: {
            day: entry.day,
            timeSlot: entry.timeSlot
          }
        }
      });

      if (existingBatchEntry) {
        return res.status(400).json({
          message: `Schedule conflict: The batch already has a class on ${entry.day} at ${entry.timeSlot}!`,
          conflictDetails: {
            subject: existingBatchEntry.subject,
            faculty: existingBatchEntry.faculty,
            day: entry.day,
            timeSlot: entry.timeSlot
          }
        });
      }
    }

    // Check for faculty schedule conflicts (same faculty, same day, same time)
    for (let entry of schedule) {
      const existingFacultyEntry = await Timetable.findOne({
        "faculty.employeeId": faculty.employeeId,
        "schedule": {
          $elemMatch: {
            day: entry.day,
            timeSlot: entry.timeSlot
          }
        }
      });

      if (existingFacultyEntry) {
        return res.status(400).json({
          message: `Faculty schedule conflict: ${faculty.firstName} ${faculty.lastName} is already assigned on ${entry.day} at ${entry.timeSlot}!`,
          conflictDetails: {
            batchId: existingFacultyEntry.batchId,
            subject: existingFacultyEntry.subject,
            day: entry.day,
            timeSlot: entry.timeSlot
          }
        });
      }
    }

    // Save the new timetable entry
    const newTimetable = new Timetable({ batchId, schedule, subject, faculty });
    await newTimetable.save();

    res.status(201).json({ message: "Timetable entry added successfully!" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});




// // Get booked schedules for a batch


app.get("/getFacultyAssignments/:subjectCode", async (req, res) => {
  try {
    const assignments = await Timetable.find({ "subject.subjectCode": req.params.subjectCode });

    let assignedFaculties = [];

    assignments.forEach(entry => {
      assignedFaculties.push({
        facultyId: entry.faculty.employeeId,
        facultyName: `${entry.faculty.firstName} ${entry.faculty.lastName}`, // Include Faculty Name
        schedule: entry.schedule
      });
    });

    res.json(assignedFaculties);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/getAssignedSchedules/:batchId", async (req, res) => {
  try {
    const schedules = await Timetable.find({ batchId: req.params.batchId });

    let bookedSlots = [];

    schedules.forEach(entry => {
      entry.schedule.forEach(slot => {
        bookedSlots.push({
          date: slot.date,
          timeSlot: slot.timeSlot,
          subjectName: entry.subject.subjectName,  // Include Subject Name
          facultyName: `${entry.faculty.firstName} ${entry.faculty.lastName}` // Include Faculty Name
        });
      });
    });

    res.json(bookedSlots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.put('/api/timetable/:id', async (req, res) => {
  try {
    const timetableId = req.params.id;
    const { subject, faculty } = req.body;

    const updatedTimetable = await Timetable.findByIdAndUpdate(
      timetableId,
      { $set: { subject, faculty } },
      { new: true }
    );

    if (!updatedTimetable) {
      return res.status(404).json({ message: 'Timetable entry not found' });
    }

    res.status(200).json(updatedTimetable);
  } catch (err) {
    console.error('Error updating timetable:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE endpoint to remove timetable entry
app.delete('/api/timetable/:id', async (req, res) => {
  try {
    const timetableId = req.params.id;

    const deletedTimetable = await Timetable.findByIdAndDelete(timetableId);

    if (!deletedTimetable) {
      return res.status(404).json({ message: 'Timetable entry not found' });
    }

    res.status(200).json({ message: 'Timetable entry deleted successfully' });
  } catch (err) {
    console.error('Error deleting timetable:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ✅ API: Fetch timetable for a batch
app.get("/getTimetable/:batchId", async (req, res) => {
  const timetable = await Timetable.find({ batchId: req.params.batchId });
  res.json(timetable);
});

const {
  DROPBOX_CLIENT_ID,
  DROPBOX_CLIENT_SECRET,
  DROPBOX_REFRESH_TOKEN

} = process.env;
let accessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 60000) {
    return accessToken;
  }

  const res = await axios.post("https://api.dropboxapi.com/oauth2/token", null, {
    params: {
      grant_type: "refresh_token",
      refresh_token: DROPBOX_REFRESH_TOKEN,
      client_id: DROPBOX_CLIENT_ID,
      client_secret: DROPBOX_CLIENT_SECRET,
    },
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  accessToken = res.data.access_token;
  tokenExpiresAt = Date.now() + res.data.expires_in * 1000;
  return accessToken;
}

app.get("/get-video-link", async (req, res) => {
  console.time("GET /get-video-link");
  const folderPath = "/RECORDING CLASSES/ENSCAPE";

  try {
    const token = await getAccessToken();

    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const listRes = await axios.post(
      "https://api.dropboxapi.com/2/files/list_folder",
      { path: folderPath },
      { headers }
    );

    const videoFiles = listRes.data.entries.filter(
      (file) => file[".tag"] === "file" && file.name.endsWith(".mp4")
    );

    const videoLinks = await Promise.all(
      videoFiles.map(async (file) => {
        const linkRes = await axios.post(
          "https://api.dropboxapi.com/2/files/get_temporary_link",
          { path: file.path_lower },
          { headers }
        );

        return {
          name: file.name,
          url: linkRes.data.link,
        };
      })
    );

    console.log(videoLinks);
    res.send({ videoLinks });
  } catch (err) {
    console.error("Error fetching videos:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch video links" });
  } finally {
    console.timeEnd("GET /get-video-link");
  }
});



app.get("/api/leave-count", async (req, res) => {
  try {
    const { employeeId, month, year } = req.query;
    if (!employeeId || !month || !year) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    // Calculate the date range for the specified month and year
    const startDate = new Date(`${year}-${month}-01`);
    const endMonth = parseInt(month) === 12 ? 1 : parseInt(month) + 1;
    const endYear = parseInt(month) === 12 ? parseInt(year) + 1 : parseInt(year);
    const endDate = new Date(`${endYear}-${endMonth < 10 ? '0' + endMonth : endMonth}-01`);

    // Find approved leaves for this employee in the specified date range
    const leaves = await Leave.find({
      employeeId: employeeId,
      status: "Approved",
      $or: [
        // Leave starts in the selected month
        { fromDate: { $gte: startDate, $lt: endDate } },
        // Leave ends in the selected month
        { toDate: { $gte: startDate, $lt: endDate } },
        // Leave spans across the selected month
        { fromDate: { $lt: startDate }, toDate: { $gte: endDate } }
      ]
    });

    // Calculate the number of leave days in the selected month
    let leaveCount = 0;
    let sundayCount = 0;

    for (const leave of leaves) {
      // Determine the effective date range to count within the month
      const effectiveStartDate = new Date(Math.max(leave.fromDate.getTime(), startDate.getTime()));
      const effectiveEndDate = new Date(Math.min(leave.toDate.getTime(), endDate.getTime() - 1)); // Subtract 1ms to exclude the first day of next month

      // If start and end dates are the same, count as 1 day
      if (effectiveStartDate.getTime() === effectiveEndDate.getTime()) {
        // Check if the day is Sunday
        if (effectiveStartDate.getDay() === 0) {
          sundayCount += 1;
        } else {
          leaveCount += 1;
        }
        continue;
      }

      // For multi-day leaves, iterate through each day and count
      let currentDate = new Date(effectiveStartDate);
      while (currentDate <= effectiveEndDate) {
        // Check if the day is Sunday (0 = Sunday, 1 = Monday, etc.)
        if (currentDate.getDay() === 0) {
          sundayCount += 1;
        } else {
          leaveCount += 1;
        }

        // Move to the next day
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    const totalDays = leaveCount + sundayCount;

    console.log("Leave count fetched successfully:", {
      leaveCount,
      sundayCount,
      totalDays
    });

    return res.status(200).json({
      leaveCount,
      sundayCount,
      totalDays
    });

  } catch (error) {
    console.error("Error fetching leave count:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/api/save-salary", async (req, res) => {
  try {
    const {
      facultyId,
      employeeId,
      salary,
      month,
      year,
      leaveCount,
      sundayCount,
      totalLeaveCount,
      deductionPerDay,
      totalDeduction,
      payableSalary,
      date
    } = req.body;

    // Check if a salary record already exists for this employee in the specified month and year
    const existingRecord = await SalaryRecord.findOne({
      facultyId,
      month,
      year
    });

    if (existingRecord) {
      return res.status(400).json({
        error: "Salary already recorded for this employee in the same month"
      });
    }

    // Create new salary record
    const salaryRecord = new SalaryRecord({
      facultyId,
      employeeId,
      salary,
      month,
      year,
      leaveCount,
      sundayCount,
      totalLeaveCount,
      deductionPerDay,
      totalDeduction,
      payableSalary,
      date: new Date(date)
    });

    await salaryRecord.save();

    return res.status(201).json({
      message: "Salary record saved successfully",
      salaryRecord
    });
  } catch (error) {
    console.error("Error saving salary record:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get('/api/salary-records', async (req, res) => {
  try {
    const records = await SalaryRecord.find({})
      .populate('facultyId', 'firstName lastName employeeId department')
      .sort({ createdAt: -1 });
    res.json(records);
  } catch (error) {
    console.error('Error fetching salary records:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/salary-records/employee/:employeeId', async (req, res) => {
  try {
    const { employeeId } = req.params;

    // Find all salary records for this employeeId
    const records = await SalaryRecord.find({ employeeId })
      .populate('facultyId', 'firstName lastName employeeId department')
      .sort({ year: -1, month: -1 }); // Sort by year and month (descending)

    res.json(records);
  } catch (error) {
    console.error('Error fetching employee salary history:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  console.log("🔹 Received Login Request:", { email, password });

  try {
    const [userDoc, facultyDoc, registrationDoc] = await Promise.all([
      User.findOne({ email }).lean(),
      Faculty.findOne({ email }).lean(),
      Registration.findOne({ email }).lean()
    ]);

    let user = userDoc || facultyDoc || registrationDoc;

    if (!user) {
      console.log("❌ User Not Found:", email);
      return res.status(400).json({ msg: "Invalid Credentials (User Not Found)" });
    }

    if (user === registrationDoc && registrationDoc.regStatus !== "Approved") {
      console.log("❌ Registration Not Approved for:", email);
      return res.status(400).json({ msg: "Your registration is not approved yet." });
    }

    console.log("✅ User Found:", { email: user.email, id: user._id });
    console.log("📝 User Object:", JSON.stringify(user, null, 2));

    if (!user.password) {
      console.log("❌ No Password Found for User:", email);
      return res.status(400).json({ msg: "Invalid Credentials (No Password)" });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    console.log("🔍 Password Match Result:", isMatch);

    if (!isMatch) {
      console.log("❌ Wrong Password for:", email);
      return res.status(400).json({ msg: "Invalid Credentials (Wrong Password)" });
    }

    // Ensure role is always an array if it exists
    let roles = [];
    if (Array.isArray(user.roles)) {
      roles = user.roles;
    } else if (Array.isArray(user.role)) {
      roles = user.role;
    } else if (user.role) {
      roles = [user.role];
    } else if (user.roles) {
      roles = [user.roles];
    }

    const normalizedRoles = roles.map((role) => String(role || "").trim());

    // Prepare payload with user information
    const payload = {
      _id: user._id,
      branchId: user.branchId,
      MasterBranchID: user.MasterBranchID,
      firstName: user.firstName || user.fName,  // Check both fields
      lastName: user.lastName || user.lName,
      email: user.email.toLowerCase(), // Convert email to lowercase
      phone: user.phone,
      roles: normalizedRoles,
      role: normalizedRoles[0] || "",
      department: user.department,
      qualification: user.qualification,
      experience: user.experience,
      gender: user.gender,
      employmentType: user.employmentType,
      status: user.status,
      employeeId: user.employeeId,
      profilePhoto: user.profilePhoto
    };

    // Debug: Log the payload to verify role is set correctly
    console.log("📦 Token Payload:", JSON.stringify(payload, null, 2));

    // Generate JWT
    const token = jwt.sign(payload, process.env.JWT_SECRET || "your_jwt_secret", { expiresIn: "1h" });

    console.log("✅ Login Successful for:", email);

    // Send token and full user data
    res.json({ token, user: payload });

  } catch (err) {
    console.error("❌ Login Error:", err);
    res.status(500).json({ msg: "Internal Server Error" });
  }
});


app.put("/api/roles/:id", async (req, res) => {
  try {
    const { roleId, roleName, permissions } = req.body;

    // Organize permissions into structured format
    const structuredPermissions = organizePermissions(permissions);

    const updatedRole = await Role.findByIdAndUpdate(
      req.params.id,
      {
        roleId,
        roleName,
        permissions, // Uncomment this line
        structuredPermissions
      },
      { new: true }
    );

    if (!updatedRole) {
      return res.status(404).json({ error: "Role not found" });
    }

    res.json(updatedRole);
  } catch (error) {
    console.error("Error updating role:", error);
    res.status(500).json({ error: "Failed to update role" });
  }
});


app.get('/api/roles/check-name', async (req, res) => {
  try {
    const { name } = req.query;

    if (!name) {
      return res.status(400).json({ message: "Role name is required" });
    }

    // Case-insensitive search
    const existingRole = await Role.findOne({
      roleName: { $regex: new RegExp(`^${name}$`, 'i') }
    });

    res.json({ exists: !!existingRole });
  } catch (error) {
    console.error("Error checking role name:", error);
    res.status(500).json({ message: "Server error" });
  }
});

const getNextSequence = async (name) => {
  const counter = await Counterrole.findByIdAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
};
app.get("/api/roles/next-id", async (req, res) => {
  try {
    // Find the current counter value without incrementing
    const counter = await Counterrole.findById("roleId") || { seq: 0 };
    // Calculate the next sequence number
    const nextSeq = counter.seq + 1;
    // Format as R01, R02, etc.
    const nextId = `R${nextSeq.toString().padStart(2, '0')}`;

    res.json({ nextId });
  } catch (error) {
    console.error("Error getting next role ID:", error);
    res.status(500).json({ error: "Failed to get next role ID" });
  }
});
// Add new role
app.post("/api/roles", async (req, res) => {
  try {
    const { roleName, permissions } = req.body;

    // Get next sequence for roleId
    const seq = await getNextSequence("roleId");
    // Format as R01, R02, etc.
    const roleId = `R${seq.toString().padStart(2, '0')}`;

    // Organize permissions into structured format
    const structuredPermissions = organizePermissions(permissions);

    const role = new Role({
      roleId,
      roleName,
      permissions,
      structuredPermissions
    });

    await role.save();
    res.status(201).json(role);
  } catch (error) {
    console.error("Error creating role:", error);
    res.status(500).json({ error: "Failed to create role" });
  }
});
// Add new role
//   app.post("/api/roles", async (req, res) => {
//     try {
//       const { roleId, roleName, permissions } = req.body;

//       // Organize permissions into structured format
//        const structuredPermissions = organizePermissions(permissions);

//       const role = new Role({
//         roleId,
//         roleName,
//         permissions,
//         structuredPermissions
//       });

//       await role.save();
//       res.status(201).json(role);
//     } catch (error) {
//       console.error("Error creating role:", error);
//       res.status(500).json({ error: "Failed to create role" });
//     }
//   });

//   // Update role
//   app.put("/api/roles/:id", async (req, res) => {
//     try {
//       const { roleId, roleName, permissions } = req.body;

//       // Organize permissions into structured format
//       const structuredPermissions = organizePermissions(permissions);

//       const updatedRole = await Role.findByIdAndUpdate(
//         req.params.id, 
//         {
//           roleId,
//           roleName,
//           // permissions,
//           structuredPermissions
//         },
//         { new: true }
//       );

//       if (!updatedRole) {
//         return res.status(404).json({ error: "Role not found" });
//       }

//       res.json(updatedRole);
//     } catch (error) {
//       console.error("Error updating role:", error);
//       res.status(500).json({ error: "Failed to update role" });
//     }
//   });

// Get all roles
app.get("/api/roles", async (req, res) => {
  try {
    const roles = await Role.find();
    res.json(roles);
  } catch (error) {
    console.error("Error fetching roles:", error);
    res.status(500).json({ error: "Failed to fetch roles" });
  }
});

// Delete role
app.delete("/api/roles/:id", async (req, res) => {
  try {
    const result = await Role.findByIdAndDelete(req.params.id);
    if (!result) {
      return res.status(404).json({ error: "Role not found" });
    }
    res.json({ message: "Role deleted successfully" });
  } catch (error) {
    console.error("Error deleting role:", error);
    res.status(500).json({ error: "Failed to delete role" });
  }
});

app.get('/api/permissions/:roleName', async (req, res) => {
  try {
    const { roleName } = req.params;
    console.log("roleid", req.params)

    // Find the role in the database
    const roleData = await Role.findOne({ roleName });

    if (!roleData) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }
    console.log("perm",roleData.structuredPermissions)

    // Return permissions for the role
    return res.status(200).json({
      success: true,
      data: roleData.structuredPermissions
    });

  } catch (error) {
    console.error('Error fetching permissions:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});
// Helper function to organize flat permissions array into structured format
function organizePermissions(permissions) {
  // Define our permission structure (same as in the frontend)
  // const permissionsStructure = {
  //   "Dashboard": ["Leads Dashboard", "Student Dashboard", "Staff Dashboard"],
  //   "Lead & Inquiry": ["Lead Capture", "Lead Assignment", "Lead Followup", "Report And Insights"],
  //   "Admission & Enrollment": [
  //     "Registration Form",
  //     "Students",
  //     "InterestedStudents",
  //     "Enrollment & Allocation",
  //     "Fee & Invoice Generation",
  //     ""

  //   ],
  //   "Student Information": [
  //     "Student Database",
  //     "Attendance Tracking",
  //     "Certificate"
  //   ],
  //   "Fee & Accounting": [
  //     "Expenses & Invoicing",
  //     "Financial Reporting"
  //   ],
  //   "Communication": [
  //     "Automated Notifications",
  //     "Communication Channels",
  //     "Event & Announcement Management"
  //   ],
  //   "Faculty & Staff": [
  //     "Staff Profiles",
  //     "Access Control",
  //     "Payroll & Salary Management",
  //     "Workload Distribution",
  //     "Time Table",
  //     "Leave Requests",
  //     "Attendance",
  //     "Attendance Tracking"
  //   ],
  //   "Course, Class & Batch": [
      
  //     "Master Branch Creation",
  //     "Branch",
  //     "Software Creation",
  //     "Course Creation",
  //     "Course Type Creation",
  //     "Batch Creation",
  //     "Timetable",
  //     "Department Form"
  //   ],
  //   "Reports and Analytics": [
  //     "Register Report",
  //     "Attendance Report",
  //     "FeePayment Report",
  //     "Walkins Report"
  //   ],
  //   "HRMS": [
  //     "Hire From Us",
  //     "Jobs",
  //     "Internal Hiring",
  //     "HR Documents",
  //     "External Job Application",
  //     "Internal Job Application",
  //     "Student DataBase"
  //   ],

  //   "Event Management": [
  //     "Event",
  //     "Eventview",
  //     "Annoucemnet"
  //   ],
  //   "Certificate": ["Certificate"],
  //   "Faculty Profile": ["Faculty Dashboard",
  //     "Faculty TimeTable",
  //     "Faculty Communication",
  //     "Attendance",
  //     "AttendanceTrack",
  //     "Assessment",
  //     "Leave Request"],

  //   "Student Profile": ["Student Dashboard",
  //     "Student Course",
  //     "Course View",
  //     "Student Payments",
  //     "Jobs Within Us",
  //     "Student Jobs",
  //     "Student Attendance",
  //     "Student Feedback",
  //   "Certificate"],
  //   "Telecaller": ["Telecaller Dashboard", "Followups"]
  // };

  const permissionsStructure = {
    "Dashboard": ["Leads Dashboard", "Student Dashboard", "Staff Dashboard","Enquiry Analysis"],
    "Lead & Inquiry": ["Lead Capture","WalkinForm","Lead Assignment", "Lead Followup", "Report And Insights"],
    "Admission & Enrollment": [
      // "Registration Form",
      "Students",
       "Batch Creation",
      "InterestedStudents",
      // "Enrollment & Allocation",
      
      "Receipts",
        "Certificate"

    ],
    "Student Information": [
      "Student Database",
      "Attendance Tracking",
  
    ],
    "Fee & Accounting": [
      "Expenses & Invoicing",
      "Financial Reporting"
    ],
    "Communication": [
      "Automated Notifications",
      "Communication Channels",
      "Event & Announcement Management"
    ],
    "Faculty & Staff": [
      "Staff Profiles",
      "Access Control",
      "Payroll & Salary Management",
      "Workload Distribution",
      "Time Table",
      "Leave Requests",
      "Attendance",
      "Attendance Tracking"
    ],
    "Course, Class & Batch": [
      
      "Master Branch Creation",
      "Branch",
      "Software Creation",
      "Course Creation",
      "Course Type Creation",
     
      "Timetable",
      "Department Form"
    ],
    "Reports and Analytics": [
      "Register Report",
      "Attendance Report",
      "FeePayment Report",
      "Walkins Report",
      "Batch Report"
    ],
    "HRMS": [
      "Hire From Us (External)",
      "Internal Jobs Application",
         "Internal Job Applicants & Details",
           "External Job Applicants & Details",
      "Jobs",
    //   "Internal Hiring",
      "HR Documents",
    
   
      "Student DataBase",
      "Faculty Performance",
    ],


    "Event Management": [
      "Event",
      "Eventview",
      "Annoucement"
    ],
    // "Certificate": ["Certificate"],
    "Faculty Profile": ["Faculty Dashboard",
      "Faculty TimeTable",
      "Faculty Communication",
    
      "Faculty Attendance",
      "AttendanceTrack",
      "Assessment",
      "Leave Request"],

    "Student Profile": ["Student Profile Dashboard",
      "Student Course",
      "Course View",
      "Student Payments",
      "Jobs Within Us",
      "Student Jobs",
      "Student Attendance",
      "Student Feedback",
    "Student Certificate"],
    "Telecaller": ["Walkin Dashboard","Tele-Enquiry Dashboard", "Call-Followups-Updates"]
  };
  const structuredPermissions = [];

  // Go through each main permission category
  for (const [mainPerm, subPerms] of Object.entries(permissionsStructure)) {
    // Check if this main permission is included
    if (permissions.includes(mainPerm)) {
      // Find all selected sub-permissions for this main permission
      const selectedSubPerms = subPerms.filter(subPerm =>
        permissions.includes(subPerm)
      );

      // Add to structured permissions
      structuredPermissions.push({
        name: mainPerm,
        subPermissions: selectedSubPerms
      });
    }
  }

  return structuredPermissions;
}


// app.post("/api/enquiry", async (req, res) => {
//   const data = req.body;
//   console.log("Received Enquiry Data:", data);

//   try {
//     // Step 1: Find the branch using branchId
//     const branch = await Branch.findOne({ branchId: data.branchId });
//     console.log("Branch Found:", branch);

//     if (!branch) {
//       return res.status(400).json({ error: "Invalid branch ID" });
//     }
//     console.log("Branch ID:", branch._id);

//     // Step 2: Find the masterBranch that references this branch
//     const masterBranch = await MasterBranch.findOne({ BranchesID: branch._id });

//     if (!masterBranch) {
//       console.log(`No master branch found for branch ID: ${data.branchId}`);
//       // Continue processing without MasterBranchID if not found
//     } else {
//       console.log("Master Branch Found:", masterBranch._id);
//     }

//     // Enhanced duplicate check:
//     // If master branch exists, check for duplicate across all branches under this master
//     // Otherwise, fall back to checking only the current branch
//     let existingEnquiry;

//     if (masterBranch) {
//       // Get all branches under this master branch
//       const allBranchesUnderMaster = await Branch.find({
//         _id: { $in: masterBranch.BranchesID }
//       });

//       const branchIds = allBranchesUnderMaster.map(b => b.branchId);
//       console.log("Checking for duplicates across branches:", branchIds);

//       // Check if email or phone already exists in any branch under this master
//       existingEnquiry = await Enquiry.findOne({
//         branchId: { $in: branchIds },
//         $or: [
//           { email: data.email },
//           { mobileNumber: data.mobileNumber }
//         ]
//       });
//     } else {
//       // Fall back to original check if no master branch
//       existingEnquiry = await Enquiry.findOne({
//         branchId: data.branchId,
//         $or: [
//           { email: data.email },
//           { mobileNumber: data.mobileNumber }
//         ]
//       });
//     }

//     // If existing enquiry found, send notification to superadmin with course info
//     if (existingEnquiry) {
//       // Find which branch this duplicate came from
//       const duplicateBranch = await Branch.findOne({ branchId: existingEnquiry.branchId });
//       const duplicateBranchName = duplicateBranch ? duplicateBranch.branchName : "Unknown Branch";

//       // Get course information if available
//       let courseInfo = "Not specified";
//       let courseTypeInfo = "Not specified";

//       if (existingEnquiry.courseId) {
//         // Fetch and populate course information
//         const course = await Course.findOne({ _id: existingEnquiry.courseId });
//         if (course) {
//           courseInfo = course.CourseName;

//           // Fetch course type information
//           if (course.CourseTypeID && course.CourseTypeID.length > 0) {
//             const courseTypes = await CourseType.find({
//               _id: { $in: course.CourseTypeID }
//             });

//             if (courseTypes && courseTypes.length > 0) {
//               courseTypeInfo = courseTypes.map(ct => ct.CourseTypeName).join(", ");
//             }
//           }
//         }
//       }

//       // Get current branch info for comparison
//       const currentBranchName = branch.branchName || "Unknown Current Branch";

//       // Get current enquiry's course information
//       let currentCourseInfo = "Not specified";
//       let currentCourseTypeInfo = "Not specified";

//       if (data.courseId) {
//         // Fetch and populate current course information
//         const currentCourse = await Course.findOne({ _id: data.courseId });
//         if (currentCourse) {
//           currentCourseInfo = currentCourse.CourseName;

//           // Fetch current course type information
//           if (currentCourse.CourseTypeID && currentCourse.CourseTypeID.length > 0) {
//             const currentCourseTypes = await CourseType.find({
//               _id: { $in: currentCourse.CourseTypeID }
//             });

//             if (currentCourseTypes && currentCourseTypes.length > 0) {
//               currentCourseTypeInfo = currentCourseTypes.map(ct => ct.CourseTypeName).join(", ");
//             }
//           }

//         }
//       }

//       const duplicateNotification = `
//         Duplicate Enquiry Detected:
        
//         Name: ${data.firstname} ${data.lastname}
//         Email: ${data.email}
//         Phone: ${data.mobileNumber}
        
//         Current Enquiry Details:
//         - Branch ID: ${data.branchId}
//         - Branch Name: ${currentBranchName}
//         - Selected Course: ${currentCourseInfo} ${data.courseId ? `(ID: ${data.courseId})` : ''}
     
        
//         Previous Registration Details:
//         - Branch ID: ${existingEnquiry.branchId}
//         - Branch Name: ${duplicateBranchName}
//         - Course: ${courseInfo}
      
//         ${masterBranch ? `- Under Master Branch: ${masterBranch.branchName || masterBranch._id}` : ''}
//         - Original Registration Date: ${existingEnquiry.createdAt ? new Date(existingEnquiry.createdAt).toLocaleString() : 'Unknown'}
//       `;
//       console.log("Duplicate Notification:", duplicateNotification);

//       const superAdminMailOptions = {
//         from: 'your-email@example.com',
//         to: `kavanajs123456@gmail.com`,
//         subject: 'Duplicate Enquiry Notification',
//         text: duplicateNotification
//       };

//       await transporter.sendMail(superAdminMailOptions);
//     }

//     // Prepare confirmation email for the enquirer
//     const emailBody = `
//     Hi ${data.firstname} ${data.lastname},
    
//     Thank you for registering with us! Here are the details you submitted:
    
//     - College Name: ${data.CollegeName}
//     - Branch ID: ${data.branchId}
//     - Branch Name: ${branch.branchName || ""}
//     - City: ${data.city}
//     - State: ${data.state}
//     - Qualification: ${data.qualification}
//     - Year of Passout: ${data.yearOfPassout}
//     - Joining Plan: ${data.joiningPlan}
//     - Referral Source: ${data.referralSource}
//     - Reference Name: ${data.ReferenceneName || "(Not Provided)"}

    
//     We have received your application and will get in touch with you soon.
    
//     If you have any questions, feel free to reply to this email.
    
//     Best regards,
//     [Your Organization Name]
//     [Contact Information]
//     `;

//     const mailOptions1 = {
//       from: 'your-email@example.com',
//       to: data.email,
//       subject: `We've Received Your Inquiry, ${data.firstname}!`,
//       text: emailBody
//     };

//     // Create enquiry object with all data from request
//     const enquiryData = {
//       ...req.body
//     };

//     // Add MasterBranchID if found
//     if (masterBranch) {
//       enquiryData.MasterBranchID = masterBranch._id;
//     }

//     // Save the new enquiry to database with MasterBranchID if available
//     const enquiry = new Enquiry(enquiryData);
//     await enquiry.save();

//     // Send confirmation email to enquirer
//     await transporter.sendMail(mailOptions1);

//     res.status(201).json({
//       message: "Enquiry data saved successfully",
//       MasterBranchID: masterBranch ? masterBranch._id : null
//     });
//   } catch (error) {
//     console.error("Error processing enquiry:", error);
//     res.status(500).json({ error: "Error saving Enquiry data" });
//   }
// });

// app.post("/api/enquiry", async (req, res) => {
//   const data = req.body;
//   console.log("Received Enquiry Data:", data);

//   try {
//     // Step 1: Find the branch using branchId
//     const branch = await Branch.findOne({ branchId: data.branchId });
//     console.log("Branch Found:", branch);

//     if (!branch) {
//       return res.status(400).json({ error: "Invalid branch ID" });
//     }
//     console.log("Branch ID:", branch._id);

//     // Step 2: Find the masterBranch that references this branch
//     const masterBranch = await MasterBranch.findOne({ BranchesID: branch._id });

//     if (!masterBranch) {
//       console.log(`No master branch found for branch ID: ${data.branchId}`);
//       // Continue processing without MasterBranchID if not found
//     } else {
//       console.log("Master Branch Found:", masterBranch._id);
//     }

//     // Enhanced duplicate check:
//     // If master branch exists, check for duplicate across all branches under this master
//     // Otherwise, fall back to checking only the current branch
//     let existingEnquiry;

//     if (masterBranch) {
//       // Get all branches under this master branch
//       const allBranchesUnderMaster = await Branch.find({
//         _id: { $in: masterBranch.BranchesID }
//       });

//       const branchIds = allBranchesUnderMaster.map(b => b.branchId);
//       console.log("Checking for duplicates across branches:", branchIds);

//       // Check if email or phone already exists in any branch under this master
//       existingEnquiry = await Enquiry.findOne({
//         branchId: { $in: branchIds },
//         $or: [
//           { email: data.email },
//           { mobileNumber: data.mobileNumber }
//         ]
//       });
//     } else {
//       // Fall back to original check if no master branch
//       existingEnquiry = await Enquiry.findOne({
//         branchId: data.branchId,
//         $or: [
//           { email: data.email },
//           { mobileNumber: data.mobileNumber }
//         ]
//       });
//     }

//     // If existing enquiry found, send notification to superadmin with course info
//     if (existingEnquiry) {
//       // Find which branch this duplicate came from
//       const duplicateBranch = await Branch.findOne({ branchId: existingEnquiry.branchId });
//       const duplicateBranchName = duplicateBranch ? duplicateBranch.branchName : "Unknown Branch";

//       // Get course information if available
//       let courseInfo = "Not specified";
//       let courseTypeInfo = "Not specified";

//       if (existingEnquiry.courseId) {
//         // Fetch and populate course information
//         const course = await Course.findOne({ _id: existingEnquiry.courseId });
//         if (course) {
//           courseInfo = course.CourseName;

//           // Fetch course type information
//           if (course.CourseTypeID && course.CourseTypeID.length > 0) {
//             const courseTypes = await CourseType.find({
//               _id: { $in: course.CourseTypeID }
//             });

//             if (courseTypes && courseTypes.length > 0) {
//               courseTypeInfo = courseTypes.map(ct => ct.CourseTypeName).join(", ");
//             }
//           }
//         }
//       }

//       // Get current branch info for comparison
//       const currentBranchName = branch.branchName || "Unknown Current Branch";

//       // Get current enquiry's course information
//       let currentCourseInfo = "Not specified";
//       let currentCourseTypeInfo = "Not specified";

//       if (data.courseId) {
//         // Fetch and populate current course information
//         const currentCourse = await Course.findOne({ _id: data.courseId });
//         if (currentCourse) {
//           currentCourseInfo = currentCourse.CourseName;

//           // Fetch current course type information
//           if (currentCourse.CourseTypeID && currentCourse.CourseTypeID.length > 0) {
//             const currentCourseTypes = await CourseType.find({
//               _id: { $in: currentCourse.CourseTypeID }
//             });

//             if (currentCourseTypes && currentCourseTypes.length > 0) {
//               currentCourseTypeInfo = currentCourseTypes.map(ct => ct.CourseTypeName).join(", ");
//             }
//           }

//         }
//       }

//       const duplicateNotification = `
//         Duplicate Enquiry Detected:
        
//         Name: ${data.firstname} ${data.lastname}
//         Email: ${data.email}
//         Phone: ${data.mobileNumber}
        
//         Current Enquiry Details:
//         - Branch ID: ${data.branchId}
//         - Branch Name: ${currentBranchName}
//         - Selected Course: ${currentCourseInfo} ${data.courseId ? `(ID: ${data.courseId})` : ''}
     
        
//         Previous Registration Details:
//         - Branch ID: ${existingEnquiry.branchId}
//         - Branch Name: ${duplicateBranchName}
//         - Course: ${courseInfo}
      
//         ${masterBranch ? `- Under Master Branch: ${masterBranch.branchName || masterBranch._id}` : ''}
//         - Original Registration Date: ${existingEnquiry.createdAt ? new Date(existingEnquiry.createdAt).toLocaleString() : 'Unknown'}
//       `;
//       console.log("Duplicate Notification:", duplicateNotification);

//       const superAdminMailOptions = {
//         from: 'your-email@example.com',
//         to: `kavanajs123456@gmail.com`,
//         subject: 'Duplicate Enquiry Notification',
//         text: duplicateNotification
//       };

//       await transporter.sendMail(superAdminMailOptions);
//     }

//     // Prepare confirmation email for the enquirer
//     const emailBody = `
//     Hi ${data.firstname} ${data.lastname},
    
//     Thank you for registering with us! Here are the details you submitted:
    
//     - College Name: ${data.CollegeName}
//     - Branch ID: ${data.branchId}
//     - Branch Name: ${branch.branchName || ""}
//     - City: ${data.city}
//     - State: ${data.state}
//     - Qualification: ${data.qualification}
//     - Year of Passout: ${data.yearOfPassout}
//     - Joining Plan: ${data.joiningPlan}
//     - Referral Source: ${data.referralSource}
//     - Reference Name: ${data.ReferenceneName || "(Not Provided)"}

    
//     We have received your application and will get in touch with you soon.
    
//     If you have any questions, feel free to reply to this email.
    
//     Best regards,
//     [Your Organization Name]
//     [Contact Information]
//     `;

//     const mailOptions1 = {
//       from: 'your-email@example.com',
//       to: data.email,
//       subject: `We've Received Your Inquiry, ${data.firstname}!`,
//       text: emailBody
//     };

//     // Create enquiry object with all data from request
//     const enquiryData = {
//       ...req.body
//     };

//     // Add MasterBranchID if found
//     if (masterBranch) {
//       enquiryData.MasterBranchID = masterBranch._id;
//     }

//     // NEW: Handle telecaller assignment if isTelecaller is true
//     if (data.isTelecaller === true && data.createdBy && data.createdBy.userId) {
//       console.log("Processing telecaller assignment...");
      
//       // Set status as assigned and assignedTo field
//       enquiryData.status = "assigned";
//       enquiryData.assignedTo = data.createdBy.userId;
      
//       console.log(`Enquiry will be assigned to telecaller: ${data.createdBy.userId}`);
//     }

//     // Save the new enquiry to database with MasterBranchID if available
//     const enquiry = new Enquiry(enquiryData);
//     const savedEnquiry = await enquiry.save();
//     console.log("Enquiry saved with ID:", savedEnquiry._id);

//     // NEW: Update Faculty record if telecaller assignment
//     if (data.isTelecaller === true && data.createdBy && data.createdBy.userId) {
//       try {
//         // Update Faculty (Add assigned enquiry to telecaller's record)
//         const updatedFaculty = await Faculty.findByIdAndUpdate(
//           data.createdBy.userId,
//           {
//             $push: { assignedEnquiries: savedEnquiry._id }
//           },
//           { new: true }
//         );
        
//         if (updatedFaculty) {
//           console.log(`Successfully assigned enquiry ${savedEnquiry._id} to telecaller ${data.createdBy.userId}`);
//         } else {
//           console.log(`Warning: Faculty with ID ${data.createdBy.userId} not found for assignment`);
//         }
//       } catch (assignmentError) {
//         console.error("Error updating telecaller assignment:", assignmentError);
//         // Don't fail the entire operation, just log the error
//       }
//     }

//     // Send confirmation email to enquirer
//     await transporter.sendMail(mailOptions1);

//     res.status(201).json({
//       message: "Enquiry data saved successfully",
//       MasterBranchID: masterBranch ? masterBranch._id : null,
//       enquiryId: savedEnquiry._id,
//       assignedTo: data.isTelecaller === true ? data.createdBy.userId : null
//     });
//   } catch (error) {
//     console.error("Error processing enquiry:", error);
//     res.status(500).json({ error: "Error saving Enquiry data" });
//   }
// });
app.post("/api/enquiry", authenticateToken, async (req, res) => {
  const data = req.body;
  if (isSubAdminUser(req.user) && req.user.branchId) {
    if (data.branchId && data.branchId !== req.user.branchId) {
      return res.status(403).json({ message: "Cross-branch operation denied" });
    }
    data.branchId = req.user.branchId;
  }
  console.log("Received Enquiry Data:", data);

  try {
    // Step 1: Find the branch using branchId
    const branch = await Branch.findOne({ branchId: data.branchId });
    console.log("Branch Found:", branch);

    if (!branch) {
      return res.status(400).json({ error: "Invalid branch ID" });
    }
    console.log("Branch ID:", branch._id);

    // Step 2: Find the masterBranch that references this branch
    const masterBranch = await MasterBranch.findOne({ BranchesID: branch._id });

    if (!masterBranch) {
      console.log(`No master branch found for branch ID: ${data.branchId}`);
      // Continue processing without MasterBranchID if not found
    } else {
      console.log("Master Branch Found:", masterBranch._id);
    }

    // Enhanced duplicate check:
    // If master branch exists, check for duplicate across all branches under this master
    // Otherwise, fall back to checking only the current branch
    let existingEnquiry;

    if (masterBranch) {
      // Get all branches under this master branch
      const allBranchesUnderMaster = await Branch.find({
        _id: { $in: masterBranch.BranchesID }
      });

      const branchIds = allBranchesUnderMaster.map(b => b.branchId);
      console.log("Checking for duplicates across branches:", branchIds);

      // Check if email or phone already exists in any branch under this master
      existingEnquiry = await Enquiry.findOne({
        branchId: { $in: branchIds },
        $or: [
          { email: data.email },
          { mobileNumber: data.mobileNumber }
        ]
      });
    } else {
      // Fall back to original check if no master branch
      existingEnquiry = await Enquiry.findOne({
        branchId: data.branchId,
        $or: [
          { email: data.email },
          { mobileNumber: data.mobileNumber }
        ]
      });
    }

    // If existing enquiry found, send notification to superadmin with course info
    if (existingEnquiry) {
      // Find which branch this duplicate came from
      const duplicateBranch = await Branch.findOne({ branchId: existingEnquiry.branchId });
      const duplicateBranchName = duplicateBranch ? duplicateBranch.branchName : "Unknown Branch";

      // Get course information if available
      let courseInfo = "Not specified";
      let courseTypeInfo = "Not specified";

      if (existingEnquiry.courseId) {
        // Fetch and populate course information
        const course = await Course.findOne({ _id: existingEnquiry.courseId });
        if (course) {
          courseInfo = course.CourseName;

          // Fetch course type information
          if (course.CourseTypeID && course.CourseTypeID.length > 0) {
            const courseTypes = await CourseType.find({
              _id: { $in: course.CourseTypeID }
            });

            if (courseTypes && courseTypes.length > 0) {
              courseTypeInfo = courseTypes.map(ct => ct.CourseTypeName).join(", ");
            }
          }
        }
      }

      // Get current branch info for comparison
      const currentBranchName = branch.branchName || "Unknown Current Branch";

      // Get current enquiry's course information
      let currentCourseInfo = "Not specified";
      let currentCourseTypeInfo = "Not specified";

      if (data.courseId) {
        // Fetch and populate current course information
        const currentCourse = await Course.findOne({ _id: data.courseId });
        if (currentCourse) {
          currentCourseInfo = currentCourse.CourseName;

          // Fetch current course type information
          if (currentCourse.CourseTypeID && currentCourse.CourseTypeID.length > 0) {
            const currentCourseTypes = await CourseType.find({
              _id: { $in: currentCourse.CourseTypeID }
            });

            if (currentCourseTypes && currentCourseTypes.length > 0) {
              currentCourseTypeInfo = currentCourseTypes.map(ct => ct.CourseTypeName).join(", ");
            }
          }

        }
      }

      // const duplicateNotification = `
      //   Duplicate Enquiry Detected:
        
      //   Name: ${data.firstname} ${data.lastname}
      //   Email: ${data.email}
      //   Phone: ${data.mobileNumber}
        
      //   Current Enquiry Details:
      //   - Branch ID: ${data.branchId}
      //   - Branch Name: ${currentBranchName}
      //   - Selected Course: ${currentCourseInfo} 
     
        
      //   Previous Registration Details:
      //   - Branch ID: ${existingEnquiry.branchId}
      //   - Branch Name: ${duplicateBranchName}
      //   - Course: ${courseInfo}
      
      //    ${masterBranch ? `- Under Master Branch: ${masterBranch.MasterBranchName || masterBranch._id}` : ''}
      //   - Original Enquiry Date: ${existingEnquiry.createdAt ? new Date(existingEnquiry.createdAt).toLocaleString() : 'Unknown'}
      // `;
      const duplicateNotification = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #f8f9fa; padding: 15px; border-left: 4px solid #dc3545; margin-bottom: 20px; }
        .alert-title { color: #dc3545; font-size: 18px; font-weight: bold; margin: 0; }
        .section { margin-bottom: 20px; }
        .section-title { color: #495057; font-size: 16px; font-weight: bold; margin-bottom: 10px; border-bottom: 2px solid #dee2e6; padding-bottom: 5px; }
        .info-grid { background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 15px; }
        .info-row { margin-bottom: 8px; }
        .label { font-weight: bold; color: #495057; display: inline-block; min-width: 120px; }
        .value { color: #212529; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; font-size: 12px; color: #6c757d; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2 class="alert-title">⚠️ Duplicate Enquiry Alert</h2>
        </div>

        <div class="section">
            <h3 class="section-title">Student Information</h3>
            <div class="info-grid">
                <div class="info-row">
                    <span class="label">Full Name:</span>
                    <span class="value">${data.firstname} ${data.lastname}</span>
                </div>
                <div class="info-row">
                    <span class="label">Email:</span>
                    <span class="value">${data.email}</span>
                </div>
                <div class="info-row">
                    <span class="label">Phone:</span>
                    <span class="value">${data.mobileNumber}</span>
                </div>
            </div>
        </div>

        <div class="section">
            <h3 class="section-title">Current Enquiry Details</h3>
            <div class="info-grid">
                <div class="info-row">
                    <span class="label">Branch ID:</span>
                    <span class="value">${data.branchId}</span>
                </div>
                <div class="info-row">
                    <span class="label">Branch Name:</span>
                    <span class="value">${currentBranchName}</span>
                </div>
                <div class="info-row">
                    <span class="label">Selected Course:</span>
                    <span class="value">${currentCourseInfo}</span>
                </div>
                <div class="info-row">
                    <span class="label">Enquiry Date:</span>
                    <span class="value">${new Date().toLocaleString()}</span>
                </div>
            </div>
        </div>

        <div class="section">
            <h3 class="section-title">Previous Registration Details</h3>
            <div class="info-grid">
                <div class="info-row">
                    <span class="label">Branch ID:</span>
                    <span class="value">${existingEnquiry.branchId}</span>
                </div>
                <div class="info-row">
                    <span class="label">Branch Name:</span>
                    <span class="value">${duplicateBranchName}</span>
                </div>
                <div class="info-row">
                    <span class="label">Course:</span>
                    <span class="value">${courseInfo}</span>
                </div>
                ${masterBranch ? `
                <div class="info-row">
                    <span class="label">Master Branch:</span>
                    <span class="value">${masterBranch.MasterBranchName || masterBranch._id}</span>
                </div>
                ` : ''}
                <div class="info-row">
                    <span class="label">Original Date:</span>
                    <span class="value">${existingEnquiry.createdAt ? new Date(existingEnquiry.createdAt).toLocaleString() : 'Unknown'}</span>
                </div>
            </div>
        </div>

        
    </div>
</body>
</html>
`;
      
      console.log("Duplicate Notification:", duplicateNotification);

      const superAdminMailOptions = {
  from: 'info@jbkacademy.in', // Use authenticated email
    // Optional: Allow replies to go to the original sender
  to: 'info@jbkacademy.in',
  subject: `Duplicate Enquiry Notification - ${data.firstname} ${data.lastname}`,
  html: `${duplicateNotification}`
};

      await transporter.sendMail(superAdminMailOptions);
    }

    // Prepare confirmation email for the enquirer
    // const emailBody = `
    // Hi ${data.firstname} ${data.lastname},
    
    // Thank you for registering with us! Here are the details you submitted:
    
    // - College Name: ${data.CollegeName}
    // - Branch ID: ${data.branchId}
    // - Branch Name: ${branch.branchName || ""}
    // - City: ${data.city}
    // - State: ${data.state}
    // - Qualification: ${data.qualification}
    // - Year of Passout: ${data.yearOfPassout}
    // - Joining Plan: ${data.joiningPlan}
    // - Referral Source: ${data.referralSource}
    // - Reference Name: ${data.ReferenceneName || "(Not Provided)"}

    
    // We have received your application and will get in touch with you soon.
    
    // If you have any questions, feel free to reply to this email.
    
    // Best regards,
    // [Your Organization Name]
    // [Contact Information]
    // `;
const emailBody = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5; }
        .container { max-width: 650px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 300; }
        .header .subtitle { margin: 10px 0 0 0; font-size: 14px; opacity: 0.9; }
        .content { padding: 30px; }
        .greeting { font-size: 18px; color: #2c3e50; margin-bottom: 20px; }
        .message { color: #34495e; margin-bottom: 25px; font-size: 16px; }
        .details-section { background-color: #f8f9fa; border-radius: 8px; padding: 25px; margin: 25px 0; }
        .section-title { color: #2c3e50; font-size: 18px; font-weight: 600; margin-bottom: 20px; border-bottom: 2px solid #3498db; padding-bottom: 8px; }
        .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        .detail-item { margin-bottom: 12px; }
        .detail-label { font-weight: 600; color: #7f8c8d; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 3px; }
        .detail-value { color: #2c3e50; font-size: 15px; font-weight: 500; }
        .next-steps { background-color: #e8f5e8; border-left: 4px solid #27ae60; padding: 20px; margin: 25px 0; border-radius: 0 5px 5px 0; }
        .next-steps-title { color: #27ae60; font-weight: 600; margin-bottom: 10px; font-size: 16px; }
        .contact-section { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; margin: 25px 0; border-radius: 0 5px 5px 0; }
        .contact-title { color: #856404; font-weight: 600; margin-bottom: 10px; font-size: 16px; }
        .footer { background-color: #2c3e50; color: #ecf0f1; padding: 25px; text-align: center; }
        .footer .company-name { font-size: 18px; font-weight: 600; margin-bottom: 10px; }
        .footer .contact-info { font-size: 14px; opacity: 0.9; color: #ecf0f1; }
        .footer .contact-info a { color: #ecf0f1 !important; text-decoration: none; }
        .footer .contact-info a:hover { color: #ffffff !important; text-decoration: underline; }
        .reference-highlight { background-color: #e3f2fd; border-left: 3px solid #2196f3; padding: 10px; margin-top: 10px; border-radius: 0 4px 4px 0; }
        @media (max-width: 600px) {
            .details-grid { grid-template-columns: 1fr; }
            .content { padding: 20px; }
            .header { padding: 20px 15px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✅ Enquiry Received</h1>
        </div>

        <div class="content">
            <div class="greeting">
                Hi <strong>${data.firstname} ${data.lastname}</strong>,
            </div>

            <div class="message">
                Thank you for your enquiry.
            </div>

            <div class="details-section">
                <div class="section-title">📋 Your Enquiry Details</div>
                
                <div class="details-grid">
                    <div class="detail-item">
                        <span class="detail-label">College Name</span>
                        <div class="detail-value">${data.CollegeName}</div>
                    </div>
                    
                    <div class="detail-item">
                        <span class="detail-label">Branch ID</span>
                        <div class="detail-value">${data.branchId}</div>
                    </div>
                    
                    <div class="detail-item">
                        <span class="detail-label">Branch Name</span>
                        <div class="detail-value">${branch.branchName || "Not Specified"}</div>
                    </div>
                    
                    <div class="detail-item">
                        <span class="detail-label">Location</span>
                        <div class="detail-value">${data.city}, ${data.state}</div>
                    </div>
                    
                    <div class="detail-item">
                        <span class="detail-label">Qualification</span>
                        <div class="detail-value">${data.qualification}</div>
                    </div>
                    
                    <div class="detail-item">
                        <span class="detail-label">Year of Passout</span>
                        <div class="detail-value">${data.yearOfPassout}</div>
                    </div>
                    
                    <div class="detail-item">
                        <span class="detail-label">Joining Plan</span>
                        <div class="detail-value">${data.joiningPlan}</div>
                    </div>
                    
                    <div class="detail-item">
                        <span class="detail-label">How did you hear about us?</span>
                        <div class="detail-value">${data.referralSource}</div>
                    </div>
                </div>

                ${data.ReferenceneName && data.ReferenceneName !== "(Not Provided)" ? `
                <div class="reference-highlight">
                    <span class="detail-label">Reference Contact</span>
                    <div class="detail-value">${data.ReferenceneName}</div>
                </div>
                ` : ''}
            </div>

            <div class="next-steps">
                <div class="next-steps-title">🚀 What's Next?</div>
                <p>Our admissions team will review your application and contact you within <strong>24-48 hours</strong> to discuss the next steps in your journey with us.</p>
                <p>In the meantime, feel free to explore our website and familiarize yourself with our programs and facilities.</p>
            </div>

            <div class="contact-section">
                <div class="contact-title">💬 Need Help?</div>
                <p>If you have any questions or need to update your information, don't hesitate to reach out to us by replying to this email or contacting our support team.</p>
            </div>
        </div>

        <div class="footer">
            <div class="company-name">JBK Academy</div>
            <div class="contact-info">
                📧 <a href="mailto:info@jbkacademy.in">info@jbkacademy.in</a> | 📞 <a href="tel:+919985023100">+91 9985023100</a><br>
                🌐 <a href="https://jbkacademy.in/" target="_blank">https://jbkacademy.in/</a>
            </div>
             <div style="text-align: center; margin: 25px 0; padding-top: 20px; border-top: 1px solid #34495e;">
          <p style="margin-bottom: 15px; font-size: 14px; color: #bdc3c7; font-weight: 300; letter-spacing: 0.5px;">
            CONNECT WITH US
          </p>
          <div>
            <a href="https://m.facebook.com/p/JBK-Academy-Hyderabad" target="_blank" style="text-decoration: none; margin: 0 12px; display: inline-block;">
              <div style="width: 40px; height: 40px; background-color: #3b5998; border-radius: 50%; display: inline-block; line-height: 40px; text-align: center;">
                <span style="color: #ffffff; font-size: 18px; font-weight: bold;">f</span>
              </div>
            </a>
            <a href="https://www.instagram.com/jbk_academy/?hl=en" target="_blank" style="text-decoration: none; margin: 0 10px; display: inline-block;">
              <div style="width: 40px; height: 40px; background: linear-gradient(45deg, #f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%); border-radius: 50%; display: inline-block; line-height: 40px; text-align: center;">
                <span style="color: #ffffff; font-size: 16px; font-weight: bold;">Insta</span>
              </div>
            </a>
            <a href="https://www.linkedin.com/company/jbk-academy" target="_blank" style="text-decoration: none; margin: 0 12px; display: inline-block;">
              <div style="width: 40px; height: 40px; background-color: #0077b5; border-radius: 50%; display: inline-block; line-height: 40px; text-align: center;">
                <span style="color: #ffffff; font-size: 16px; font-weight: bold;">in</span>
              </div>
            </a>
            <a href="https://m.youtube.com/channel/UCSxp1XWEBEfWDhsiUCGYJ7A" target="_blank" style="text-decoration: none; margin: 0 12px; display: inline-block;">
              <div style="width: 40px; height: 40px; background-color: #ff0000; border-radius: 50%; display: inline-block; line-height: 40px; text-align: center;">
                <span style="color: #ffffff; font-size: 14px; font-weight: bold;">▶</span>
              </div>
            </a>
            <a href="https://wa.me/919985023100" target="_blank" style="text-decoration: none; margin: 0 12px; display: inline-block;">
              <div style="width: 40px; height: 40px; background-color: #25d366; border-radius: 50%; display: inline-block; line-height: 40px; text-align: center;">
                <span style="color: #ffffff; font-size: 16px; font-weight: bold;">W</span>
              </div>
            </a>
          </div>
        </div>
        </div>
    </div>
</body>
</html>
`;

    const mailOptions1 = {
      from: 'info@jbkacademy.in',
      to: data.email,
      subject: `We've Received Your Inquiry, ${data.firstname}!`,
      html: emailBody
    };

    // Create enquiry object with all data from request
    const enquiryData = {
      ...req.body
    };

    // Add MasterBranchID if found
    if (masterBranch) {
      enquiryData.MasterBranchID = masterBranch._id;
    }

    // NEW: Handle telecaller assignment if isTelecaller is true
    if (data.isTelecaller === true && data.createdBy && data.createdBy.userId) {
      console.log("Processing telecaller assignment...");
      
      // Set status as assigned and assignedTo field
      enquiryData.status = "assigned";
      enquiryData.assignedTo = data.createdBy.userId;
      
      console.log(`Enquiry will be assigned to telecaller: ${data.createdBy.userId}`);
    }

    // Save the new enquiry to database with MasterBranchID if available
    const enquiry = new Enquiry(enquiryData);
    const savedEnquiry = await enquiry.save();
    console.log("Enquiry saved with ID:", savedEnquiry._id);

    // NEW: Update Faculty record if telecaller assignment
    if (data.isTelecaller === true && data.createdBy && data.createdBy.userId) {
      try {
        // Update Faculty (Add assigned enquiry to telecaller's record)
        const updatedFaculty = await Faculty.findByIdAndUpdate(
          data.createdBy.userId,
          {
            $push: { assignedEnquiries: savedEnquiry._id }
          },
          { new: true }
        );
        
        if (updatedFaculty) {
          console.log(`Successfully assigned enquiry ${savedEnquiry._id} to telecaller ${data.createdBy.userId}`);
        } else {
          console.log(`Warning: Faculty with ID ${data.createdBy.userId} not found for assignment`);
        }
      } catch (assignmentError) {
        console.error("Error updating telecaller assignment:", assignmentError);
        // Don't fail the entire operation, just log the error
      }
    }

    // Send confirmation email to enquirer
try {
  await transporter.sendMail(mailOptions1);
  console.log("Confirmation email sent successfully to:", data.email);
} catch (emailError) {
  console.error("Failed to send confirmation email:", emailError.message);
  // Don't throw error - enquiry is already saved
}


    res.status(201).json({
      message: "Enquiry data saved successfully",
      MasterBranchID: masterBranch ? masterBranch._id : null,
      enquiryId: savedEnquiry._id,
      assignedTo: data.isTelecaller === true ? data.createdBy.userId : null
    });
  } catch (error) {
    console.error("Error processing enquiry:", error);
    res.status(500).json({ error: "Error saving Enquiry data" });
  }
});
// app.post("/api/enquiry", async (req, res) => {
//   const data = req.body;
//   console.log("Received Enquiry Data:", data);

//   try {
//     // Step 1: Find the branch using branchId
//     const branch = await Branch.findOne({ branchId: data.branchId });
//     console.log("Branch Found:", branch);

//     if (!branch) {
//       return res.status(400).json({ error: "Invalid branch ID" });
//     }
//     console.log("Branch ID:", branch._id);

//     // Step 2: Find the masterBranch that references this branch
//     const masterBranch = await MasterBranch.findOne({ BranchesID: branch._id });

//     if (!masterBranch) {
//       console.log(`No master branch found for branch ID: ${data.branchId}`);
//     } else {
//       console.log("Master Branch Found:", masterBranch._id);
//     }

//     // Enhanced duplicate check
//     let existingEnquiry;

//     if (masterBranch) {
//       const allBranchesUnderMaster = await Branch.find({
//         _id: { $in: masterBranch.BranchesID }
//       });

//       const branchIds = allBranchesUnderMaster.map(b => b.branchId);
//       console.log("Checking for duplicates across branches:", branchIds);

//       existingEnquiry = await Enquiry.findOne({
//         branchId: { $in: branchIds },
//         $or: [
//           { email: data.email },
//           { mobileNumber: data.mobileNumber }
//         ]
//       });
//     } else {
//       existingEnquiry = await Enquiry.findOne({
//         branchId: data.branchId,
//         $or: [
//           { email: data.email },
//           { mobileNumber: data.mobileNumber }
//         ]
//       });
//     }

//     // Create enquiry object with all data from request
//     const enquiryData = {
//       ...req.body
//     };

//     // Add MasterBranchID if found
//     if (masterBranch) {
//       enquiryData.MasterBranchID = masterBranch._id;
//     }

//     // Handle telecaller assignment if isTelecaller is true
//     if (data.isTelecaller === true && data.createdBy && data.createdBy.userId) {
//       console.log("Processing telecaller assignment...");
//       enquiryData.status = "assigned";
//       enquiryData.assignedTo = data.createdBy.userId;
//       console.log(`Enquiry will be assigned to telecaller: ${data.createdBy.userId}`);
//     }

//     // ========== SAVE ENQUIRY FIRST (Most Important) ==========
//     const enquiry = new Enquiry(enquiryData);
//     const savedEnquiry = await enquiry.save();
//     console.log("✅ Enquiry saved successfully with ID:", savedEnquiry._id);

//     // Update Faculty record if telecaller assignment
//     if (data.isTelecaller === true && data.createdBy && data.createdBy.userId) {
//       try {
//         const updatedFaculty = await Faculty.findByIdAndUpdate(
//           data.createdBy.userId,
//           { $push: { assignedEnquiries: savedEnquiry._id } },
//           { new: true }
//         );
        
//         if (updatedFaculty) {
//           console.log(`✅ Successfully assigned enquiry to telecaller ${data.createdBy.userId}`);
//         } else {
//           console.log(`⚠️ Warning: Faculty with ID ${data.createdBy.userId} not found`);
//         }
//       } catch (assignmentError) {
//         console.error("❌ Error updating telecaller assignment:", assignmentError);
//       }
//     }

//     // ========== SEND EMAILS (Non-Critical Operations) ==========
    
//     // 1. Send duplicate notification email to superadmin (if duplicate found)
//     if (existingEnquiry) {
//       try {
//         const duplicateBranch = await Branch.findOne({ branchId: existingEnquiry.branchId });
//         const duplicateBranchName = duplicateBranch ? duplicateBranch.branchName : "Unknown Branch";

//         let courseInfo = "Not specified";
//         if (existingEnquiry.courseId) {
//           const course = await Course.findOne({ _id: existingEnquiry.courseId });
//           if (course) {
//             courseInfo = course.CourseName;
//           }
//         }

//         const currentBranchName = branch.branchName || "Unknown Current Branch";
//         let currentCourseInfo = "Not specified";
//         if (data.courseId) {
//           const currentCourse = await Course.findOne({ _id: data.courseId });
//           if (currentCourse) {
//             currentCourseInfo = currentCourse.CourseName;
//           }
//         }

//         const duplicateNotification = `
// <!DOCTYPE html>
// <html>
// <head>
//     <meta charset="UTF-8">
//     <style>
//         body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
//         .container { max-width: 600px; margin: 0 auto; padding: 20px; }
//         .header { background-color: #f8f9fa; padding: 15px; border-left: 4px solid #dc3545; margin-bottom: 20px; }
//         .alert-title { color: #dc3545; font-size: 18px; font-weight: bold; margin: 0; }
//         .section { margin-bottom: 20px; }
//         .section-title { color: #495057; font-size: 16px; font-weight: bold; margin-bottom: 10px; border-bottom: 2px solid #dee2e6; padding-bottom: 5px; }
//         .info-grid { background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 15px; }
//         .info-row { margin-bottom: 8px; }
//         .label { font-weight: bold; color: #495057; display: inline-block; min-width: 120px; }
//         .value { color: #212529; }
//     </style>
// </head>
// <body>
//     <div class="container">
//         <div class="header">
//             <h2 class="alert-title">⚠️ Duplicate Enquiry Alert</h2>
//         </div>
//         <div class="section">
//             <h3 class="section-title">Student Information</h3>
//             <div class="info-grid">
//                 <div class="info-row">
//                     <span class="label">Full Name:</span>
//                     <span class="value">${data.firstname} ${data.lastname}</span>
//                 </div>
//                 <div class="info-row">
//                     <span class="label">Email:</span>
//                     <span class="value">${data.email}</span>
//                 </div>
//                 <div class="info-row">
//                     <span class="label">Phone:</span>
//                     <span class="value">${data.mobileNumber}</span>
//                 </div>
//             </div>
//         </div>
//         <div class="section">
//             <h3 class="section-title">Current Enquiry Details</h3>
//             <div class="info-grid">
//                 <div class="info-row">
//                     <span class="label">Branch ID:</span>
//                     <span class="value">${data.branchId}</span>
//                 </div>
//                 <div class="info-row">
//                     <span class="label">Branch Name:</span>
//                     <span class="value">${currentBranchName}</span>
//                 </div>
//                 <div class="info-row">
//                     <span class="label">Selected Course:</span>
//                     <span class="value">${currentCourseInfo}</span>
//                 </div>
//                 <div class="info-row">
//                     <span class="label">Enquiry Date:</span>
//                     <span class="value">${new Date().toLocaleString()}</span>
//                 </div>
//             </div>
//         </div>
//         <div class="section">
//             <h3 class="section-title">Previous Registration Details</h3>
//             <div class="info-grid">
//                 <div class="info-row">
//                     <span class="label">Branch ID:</span>
//                     <span class="value">${existingEnquiry.branchId}</span>
//                 </div>
//                 <div class="info-row">
//                     <span class="label">Branch Name:</span>
//                     <span class="value">${duplicateBranchName}</span>
//                 </div>
//                 <div class="info-row">
//                     <span class="label">Course:</span>
//                     <span class="value">${courseInfo}</span>
//                 </div>
//                 ${masterBranch ? `
//                 <div class="info-row">
//                     <span class="label">Master Branch:</span>
//                     <span class="value">${masterBranch.MasterBranchName || masterBranch._id}</span>
//                 </div>
//                 ` : ''}
//                 <div class="info-row">
//                     <span class="label">Original Date:</span>
//                     <span class="value">${existingEnquiry.createdAt ? new Date(existingEnquiry.createdAt).toLocaleString() : 'Unknown'}</span>
//                 </div>
//             </div>
//         </div>
//     </div>
// </body>
// </html>
// `;

//         const superAdminMailOptions = {
//           from: 'info@jbkacademy.in',
//           to: 'info@jbkacademy.in',
//           subject: `Duplicate Enquiry Notification - ${data.firstname} ${data.lastname}`,
//           html: duplicateNotification
//         };

//         await transporter.sendMail(superAdminMailOptions);
//         console.log("✅ Duplicate notification email sent successfully");
//       } catch (emailError) {
//         console.error("❌ Failed to send duplicate notification email:", emailError.message);
//         // Continue execution - don't throw error
//       }
//     }

//     // 2. Send confirmation email to enquirer
//     try {
//       const emailBody = `
// <!DOCTYPE html>
// <html>
// <head>
//     <meta charset="UTF-8">
//     <style>
//         body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5; }
//         .container { max-width: 650px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
//         .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px 20px; text-align: center; }
//         .header h1 { margin: 0; font-size: 24px; font-weight: 300; }
//         .content { padding: 30px; }
//         .greeting { font-size: 18px; color: #2c3e50; margin-bottom: 20px; }
//         .message { color: #34495e; margin-bottom: 25px; font-size: 16px; }
//         .details-section { background-color: #f8f9fa; border-radius: 8px; padding: 25px; margin: 25px 0; }
//         .section-title { color: #2c3e50; font-size: 18px; font-weight: 600; margin-bottom: 20px; border-bottom: 2px solid #3498db; padding-bottom: 8px; }
//         .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
//         .detail-item { margin-bottom: 12px; }
//         .detail-label { font-weight: 600; color: #7f8c8d; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 3px; }
//         .detail-value { color: #2c3e50; font-size: 15px; font-weight: 500; }
//         .footer { background-color: #2c3e50; color: #ecf0f1; padding: 25px; text-align: center; }
//         @media (max-width: 600px) {
//             .details-grid { grid-template-columns: 1fr; }
//         }
//     </style>
// </head>
// <body>
//     <div class="container">
//         <div class="header">
//             <h1>✅ Enquiry Received</h1>
//         </div>
//         <div class="content">
//             <div class="greeting">
//                 Hi <strong>${data.firstname} ${data.lastname}</strong>,
//             </div>
//             <div class="message">
//                 Thank you for your enquiry.
//             </div>
//             <div class="details-section">
//                 <div class="section-title">📋 Your Enquiry Details</div>
//                 <div class="details-grid">
//                     <div class="detail-item">
//                         <span class="detail-label">College Name</span>
//                         <div class="detail-value">${data.CollegeName}</div>
//                     </div>
//                     <div class="detail-item">
//                         <span class="detail-label">Branch Name</span>
//                         <div class="detail-value">${branch.branchName || "Not Specified"}</div>
//                     </div>
//                     <div class="detail-item">
//                         <span class="detail-label">Location</span>
//                         <div class="detail-value">${data.city}, ${data.state}</div>
//                     </div>
//                     <div class="detail-item">
//                         <span class="detail-label">Qualification</span>
//                         <div class="detail-value">${data.qualification}</div>
//                     </div>
//                 </div>
//             </div>
//         </div>
//         <div class="footer">
//             <div>JBK Academy</div>
//             <div>📧 info@jbkacademy.in | 📞 +91 9985023100</div>
//         </div>
//     </div>
// </body>
// </html>
// `;

//       const mailOptions1 = {
//         from: 'info@jbkacademy.in',
//         to: data.email,
//         subject: `We've Received Your Inquiry, ${data.firstname}!`,
//         html: emailBody
//       };

//       await transporter.sendMail(mailOptions1);
//       console.log("✅ Confirmation email sent successfully to enquirer");
//     } catch (emailError) {
//       console.error("❌ Failed to send confirmation email:", emailError.message);
//       // Continue execution - don't throw error
//     }

//     // ========== SEND SUCCESS RESPONSE ==========
//     res.status(201).json({
//       message: "Enquiry data saved successfully",
//       MasterBranchID: masterBranch ? masterBranch._id : null,
//       enquiryId: savedEnquiry._id,
//       assignedTo: data.isTelecaller === true ? data.createdBy.userId : null
//     });

//   } catch (error) {
//     console.error("❌ Error processing enquiry:", error);
//     res.status(500).json({ error: "Error saving Enquiry data" });
//   }
// });
app.delete("/api/enquiry/:id", authenticateToken, async (req, res) => {
  const enquiryId = req.params.id;

  try {
    // Find the enquiry first to get associated telecaller/faculty IDs
    const enquiry = await Enquiry.findById(enquiryId);

    if (!enquiry) {
      return res.status(404).json({ message: "Enquiry not found" });
    }

    if (
      isSubAdminUser(req.user) &&
      req.user.branchId &&
      enquiry.branchId !== req.user.branchId
    ) {
      return res.status(403).json({ message: "Access denied for this branch" });
    }

    // Get list of faculty/telecaller IDs who have this enquiry in their followUps
    // Extract all telecaller IDs from the enquiry's followUps
    const teleCaller_ids = enquiry.followUps.map(followUp => followUp.teleCaller);

    // Update all associated faculty documents by removing this enquiry from their followUps
    await Faculty.updateMany(
      { _id: { $in: teleCaller_ids } },
      { $pull: { followUps: { enquiryId: enquiryId } } }
    );

    // Finally delete the enquiry itself
    await Enquiry.findByIdAndDelete(enquiryId);

    res.status(200).json({
      success: true,
      message: "Enquiry deleted successfully from all records"
    });

  } catch (error) {
    console.error("Error deleting enquiry:", error);
    res.status(500).json({
      message: "Error deleting enquiry",
      error: error.message
    });
  }
});

// app.get("/api/enquiries", authenticateToken, async (req, res) => {
//   try {
//     const query = buildBranchQuery(req.user, req.query.branchId);

//     if (req.query.status) {
//       query.status = req.query.status;
//     }
//     if (req.query.dateFrom || req.query.dateTo) {
//       query.createdAt = {};
//       if (req.query.dateFrom) query.createdAt.$gte = new Date(req.query.dateFrom);
//       if (req.query.dateTo) query.createdAt.$lte = new Date(req.query.dateTo);
//     }

//     const all = String(req.query.all) === 'true';
//     const page = Math.max(Number(req.query.page) || 1, 1);
//     const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
//     const skip = (page - 1) * limit;

//     const baseQuery = Enquiry.find(query)
//       .select('firstname lastname mobileNumber status assignedTo branchId createdAt formatting qualification ModeofLearning CurrentOccupationStatus state referralSource joiningPlan followUps')
//       .populate({ path: 'courseId', select: 'CourseName' })
//       .populate({ path: 'interestedSubjects', select: 'SubjectName' })
//       .populate({ path: 'MasterBranchID', select: 'MasterBranchName' })
//       .populate({ path: 'assignedTo', select: 'firstName lastName email' })
//       .lean();

//     const [enquiries, total] = await Promise.all([
//       all ? baseQuery : baseQuery.skip(skip).limit(limit),
//       Enquiry.countDocuments(query),
//     ]);

//     res.json({ total, page, limit: all ? total : limit, enquiries });
//   } catch (error) {
//     console.error('Error fetching enquiries:', error);
//     res.status(500).json({ error: 'Server error' });
//   }
// });


app.get("/api/enquiries", authenticateToken, async (req, res) => {
  try {
    // Build branch query
    const query = buildBranchQuery(
      req.user,
      req.query.branchId
    );

    // Status filter
    if (req.query.status) {
      query.status = req.query.status;
    }

    // Date filter
    if (req.query.dateFrom || req.query.dateTo) {
      query.createdAt = {};

      if (req.query.dateFrom) {
        query.createdAt.$gte = new Date(
          req.query.dateFrom
        );
      }

      if (req.query.dateTo) {
        query.createdAt.$lte = new Date(
          req.query.dateTo
        );
      }
    }

    // Pagination
    const all = String(req.query.all) === "true";

    const page = Math.max(
      Number(req.query.page) || 1,
      1
    );

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 20, 1),
      100
    );

    const skip = (page - 1) * limit;

    // Base Query
    const baseQuery = Enquiry.find(query)

      // IMPORTANT: only required fields
      .select(`
        firstname
        lastname
        mobileNumber
        status
        assignedTo
        branchId
        createdAt
        formatting
        qualification
        ModeofLearning
        CurrentOccupationStatus
        state
        referralSource
        joiningPlan
        followUps
        courseId
        interestedSubjects
        MasterBranchID
      `)

      // Course
      .populate({
        path: "courseId",
        select: "CourseName"
      })

      // Subjects
      .populate({
        path: "interestedSubjects",
        select: "SubjectName"
      })

      // Master Branch
      .populate({
        path: "MasterBranchID",
        select: "MasterBranchName"
      })

      // Assigned Telecaller
      .populate({
        path: "assignedTo",
        select: "firstName lastName email"
      })

      // PERFORMANCE BOOST
      .sort({ createdAt: -1 })

      // PERFORMANCE BOOST
      .lean();

    // Run queries in parallel
    const [enquiries, total] = await Promise.all([
      all
        ? baseQuery
        : baseQuery.skip(skip).limit(limit),

      Enquiry.countDocuments(query),
    ]);

    // Response
    res.json({
      total,
      page,
      limit: all ? total : limit,
      enquiries,
    });

  } catch (error) {
    console.error(
      "Error fetching enquiries:",
      error
    );

    res.status(500).json({
      error: "Server error",
    });
  }
});
app.get("/api/old/enquiries", async (req, res) => {
  try {
    const page = Number(req.query.page) || 0;
    const limit = Number(req.query.limit) || 0;

    let query = Enquiry.find()
      .populate('courseId', 'CourseName')
      .populate('interestedSubjects', 'SubjectName')
      .lean();

    if (page > 0 && limit > 0) {
      query = query.skip((page - 1) * limit).limit(limit);
    }

    const enquiries = await query;
    res.json(enquiries);
  } catch (error) {
    console.error("Error fetching enquiries:", error);
    res.status(500).json({ error: "Server error" });
  }
});
// app.get("/api/assign/enquiries", async (req, res) => {
//   try {
//     const enquiries = await Enquiry.find()
//       .populate({
//         path: "courseId",
//         select: "CourseName duration payment"
//       });

//     const enhancedEnquiries = enquiries.map(enquiry => {
//       const doc = enquiry.toObject();
//       if (doc.courseId) {
//         doc.courseName = doc.courseId.CourseName;
//         doc.courseDuration = doc.courseId.duration;
//         doc.coursePayment = doc.courseId.payment;
//       }
//       return doc;
//     });

//     console.log("Enhanced Enquiries:", enhancedEnquiries);
//     res.json(enhancedEnquiries);

//   } catch (error) {
//     console.error("Error fetching enquiries:", error);
//     res.status(500).json({ error: "Server error" });
//   }
// });
// app.get("/api/assign/enquiries", async (req, res) => {
//   try {
//     const enquiries = await Enquiry.find()
//       .populate({
//         path: "courseId",
//         select: "CourseName duration payment"
//       })
//       .populate({
//         path: "interestedSubjects",
//         select: "SubjectName SubjectId"  // Adjust based on your Subject schema
//       });

//     const enhancedEnquiries = enquiries.map(enquiry => {
//       const doc = enquiry.toObject();

//       if (doc.courseId) {
//         doc.courseName = doc.courseId.CourseName;
//         doc.courseDuration = doc.courseId.duration;
//         doc.coursePayment = doc.courseId.payment;
//       }

//       if (doc.interestedSubjects && Array.isArray(doc.interestedSubjects)) {
//         doc.subjects = doc.interestedSubjects.map(sub => ({
//           id: sub._id,
//           name: sub.SubjectName,
//           code: sub.SubjectId
//         }));
//       }

//       return doc;
//     });

//     console.log("Enhanced Enquiries:", enhancedEnquiries);
//     res.json(enhancedEnquiries);

//   } catch (error) {
//     console.error("Error fetching enquiries:", error);
//     res.status(500).json({ error: "Server error" });
//   }
// });
app.get("/api/assign/enquiries", async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const [enquiries, total] = await Promise.all([
      Enquiry.find()
.select(`
  firstname
  lastname
  mobileNumber
  status
  branchId
  assignedTo
  createdAt
  formatting
  interestedSubjects
  courseId
`)        .populate({ path: 'courseId', select: 'CourseName duration payment' })
        .populate({ path: 'interestedSubjects', select: 'SubjectName SubjectId' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Enquiry.countDocuments(),
    ]);

    const enhancedEnquiries = enquiries.map(doc => {
      if (Array.isArray(doc.courseId)) {
        doc.courses = doc.courseId.map(course => ({
          id: course._id,
          name: course.CourseName,
          duration: course.duration,
          payment: course.payment,
        }));
      }

      if (doc.interestedSubjects && Array.isArray(doc.interestedSubjects)) {
        doc.subjects = doc.interestedSubjects.map(sub => ({
          id: sub._id,
          name: sub.SubjectName,
          code: sub.SubjectId,
        }));
      }

      return doc;
    });

    res.json({ total, page, limit, enquiries: enhancedEnquiries });
  } catch (error) {
    console.error("Error fetching enquiries:", error);
    res.status(500).json({ error: "Server error" });
  }
});


app.get("/api/telecallers/:branchId", async (req, res) => {
  try {
    const { branchId } = req.params;
    const telecallers = await Faculty.find({
      branchId,
      role: { $in: ["Telecaller"] },
    }).lean();
    res.json(telecallers);
  } catch (err) {
    res.status(500).json({ error: "Server error fetching telecallers" });
  }
});

app.post("/api/assign-enquiry", async (req, res) => {
  try {
    const { enquiryId, telecallerId } = req.body;

    // Update Enquiry
    const enquiry = await Enquiry.findByIdAndUpdate(enquiryId, {
      status: "assigned",
      assignedTo: telecallerId,
    });

    // Update Faculty (Optional: Add assigned enquiries to telecaller's record)
    await Faculty.findByIdAndUpdate(telecallerId, {
      $push: { assignedEnquiries: enquiryId },
    });

    res.json({ message: "Enquiry assigned successfully" });
  } catch (err) {
    res.status(500).json({ error: "Error assigning enquiry" });
  }
});

// app.get("/api/assigned-enquiries/:telecallerId", async (req, res) => {
//   try {
//     const { telecallerId } = req.params;
//     const enquiries = await Enquiry.find({ assignedTo: telecallerId });
//     res.json(enquiries);
//   } catch (err) {
//     res.status(500).json({ error: "Error fetching assigned enquiries" });
//   }
// });
app.get("/api/assigned-enquiries/:telecallerId", async (req, res) => {
  try {
    const { telecallerId } = req.params;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const [enquiries, total] = await Promise.all([
      Enquiry.find({ assignedTo: telecallerId })
        .select('firstname lastname mobileNumber status branchId assignedTo createdAt')
        .populate('courseId', 'CourseName')
        .populate('interestedSubjects', 'SubjectName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Enquiry.countDocuments({ assignedTo: telecallerId }),
    ]);

    res.json({ total, page, limit, enquiries });
  } catch (err) {
    console.error("Error fetching enquiries:", err);
    res.status(500).json({ error: "Error fetching assigned enquiries" });
  }
});

app.get('/api/dashboard/summary', authenticateToken, async (req, res) => {
  try {
    const branchQuery = buildBranchQuery(req.user, req.query.branchId);
    const branchId = branchQuery.branchId;
    const cacheKey = `dashboard:${branchId || 'global'}:${req.query.dateFrom || 'all'}:${req.query.dateTo || 'all'}`;

    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const summary = await getDashboardSummary({
      Enquiry,
      Registration,
      Faculty,
      branchId,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
    });

    await setCache(cacheKey, summary, DASHBOARD_CACHE_TTL);
    res.json({ ...summary, cached: false });
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    res.status(500).json({ error: 'Error fetching dashboard summary' });
  }
});

app.get('/api/dashboard/enquiries', authenticateToken, async (req, res) => {
  try {
    const branchQuery = buildBranchQuery(req.user, req.query.branchId);
    const branchId = branchQuery.branchId;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    const { enquiries, total } = await getDashboardEnquiries({
      Enquiry,
      branchId,
      status: req.query.status,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      page,
      limit,
    });

    res.json({ total, page, limit, enquiries });
  } catch (error) {
    console.error('Error fetching dashboard enquiries:', error);
    res.status(500).json({ error: 'Error fetching dashboard enquiries' });
  }
});

app.post("/api/save-followup", async (req, res) => {
  const { enquiryId, userId, status,remark, followUpDates } = req.body;
  console.log("leadfollowups", req.body);

  try {
    // Use ISO format for today's date (YYYY-MM-DD)
    const currentDate = new Date().toISOString().split('T')[0];
    const nextFollowUpDate = followUpDates.length > 0 ? followUpDates[0] : null;

    // ✅ Update follow-up in Enquiry without full document validation
    await Enquiry.updateOne(
      { _id: enquiryId },
      {
        $push: {
          followUps: {
            teleCaller: userId,
            status,
            followedUpDate: currentDate,
            nextFollowUpDate,
            remark // Add remark to follow-up
          }
        },
        ...(status && { status }) // only update status if provided
      }
    );

    // ✅ Update follow-up in Faculty without full document validation
    await Faculty.updateOne(
      { _id: userId },
      {
        $push: {
          followUps: {
            enquiryId,
            status,
            followedUpDate: currentDate,
            nextFollowUpDate,
            remark // Add remark to follow-up
          }
        }
      }
    );

    res.status(200).json({ message: "Follow-up saved successfully" });

  } catch (error) {
    console.error("Error saving follow-up:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.get("/api/followups/:enquiryId", async (req, res) => {
  try {
    const { enquiryId } = req.params;

    const faculty = await Faculty.findOne(
      { "followUps.enquiryId": enquiryId },
      { "followUps": 1, _id: 0 } // Fetch all follow-ups for this enquiryId
    );

    res.json({ followUps: faculty ? faculty.followUps : [] });
  } catch (error) {
    console.error("Error fetching follow-ups:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// app.get("/api/followups", async (req, res) => {
//   try {
//     const { branchId, includeCourseDetails } = req.query;

//     let filter = { role: { $in: ["Telecaller"] } }; // Only telecallers
//     if (branchId) {
//       filter.branchId = branchId;
//     }

//     const telecallers = await Faculty.find(filter)
//       .populate({
//         path: "assignedEnquiries",
//         select: "firstname lastname mobileNumber interestedCourses branchId createdAt email _id courseId",
//         // Add course population for assigned enquiries
//         populate: includeCourseDetails === "true" ? {
//           path: "courseId",
//           model: "Course",
//           select: "CourseName courseCode CourseID"
//         } : undefined
//       })
//       .populate({
//         path: "followUps.enquiryId",
//         model: "Enquiry",
//         select: "firstname lastname mobileNumber interestedCourses branchId createdAt email courseId",
//         populate: includeCourseDetails === "true" ? {
//           path: "courseId",
//           model: "Course",
//           select: "CourseName CourseID"
//         } : undefined
//       })
//       .select("assignedEnquiries followUps branchId firstName lastName _id");

//     // Format the response for easier consumption on frontend
//     const formattedResponse = telecallers.map(telecaller => {
//       return {
//         _id: telecaller._id,
//         firstName: telecaller.firstName,
//         lastName: telecaller.lastName,
//         branchId: telecaller.branchId,
//         assignedEnquiries: telecaller.assignedEnquiries,
//         followUps: telecaller.followUps.map(followUp => {
//           // Make sure we have all necessary data
//           if (followUp.enquiryId) {
//             return {
//               ...followUp.toObject(),
//               enquiryDetails: {
//                 _id: followUp.enquiryId._id,
//                 firstname: followUp.enquiryId.firstname,
//                 lastname: followUp.enquiryId.lastname,
//                 email: followUp.enquiryId.email,
//                 mobileNumber: followUp.enquiryId.mobileNumber,
//                 branchId: followUp.enquiryId.branchId,
//                 createdAt: followUp.enquiryId.createdAt,
//                 // Include course details if available
//                 course: followUp.enquiryId.courseId ? {
//                   id: followUp.enquiryId.courseId._id,
//                   name: followUp.enquiryId.courseId.CourseName,
//                   code: followUp.enquiryId.courseId.CourseID
//                 } : null
//               }
//             };
//           }
//           return followUp;
//         })
//       };
//     });

//     console.log("Formatted telecallers data for frontend", formattedResponse);
//     res.json({ followUps: formattedResponse });
//   } catch (error) {
//     console.error("Error fetching follow-ups:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// });
// app.get("/api/followups", async (req, res) => {
//   try {
//     const { branchId, includeCourseDetails } = req.query;

//     let filter = { role: { $in: ["Telecaller"] } }; // Only telecallers
//     if (branchId) {
//       filter.branchId = branchId;
//     }

//     const telecallers = await Faculty.find(filter)
//       // .populate({
//       //   path: "assignedEnquiries",
//       //   select: "firstname lastname mobileNumber interestedCourses branchId createdAt email _id courseId",
//       //   // Add course population for assigned enquiries
//       //   populate: includeCourseDetails === "true" ? {
//       //     path: "courseId",
//       //     model: "Course",
//       //     select: "CourseName courseCode CourseID"
//       //   } : undefined
//       // })
//       // .populate({
//       //   path: "followUps.enquiryId",
//       //   model: "Enquiry",
//       //   select: "firstname lastname mobileNumber interestedCourses branchId createdAt email courseId",
//       //   populate: includeCourseDetails === "true" ? {
//       //     path: "courseId", 
//       //     model: "Course",
//       //     select: "CourseName CourseID"
//       //   } : undefined
//       // })
//       // .select("assignedEnquiries followUps branchId firstName lastName _id");
//       .populate({
//         path: "assignedEnquiries",
//         select: "firstname lastname mobileNumber interestedCourses branchId createdAt email _id courseId interestedSubjects",
//         populate: [
//           includeCourseDetails === "true" ? {
//             path: "courseId",
//             model: "Course",
//             select: "CourseName courseCode CourseID"
//           } : null,
//           {
//             path: "interestedSubjects",
//             model: "Subject",
//             select: "SubjectName SubjectId" // Adjust field names as per your Subject schema
//           }
//         ].filter(Boolean)
//       })
//       .populate({
//         path: "followUps.enquiryId",
//         model: "Enquiry",
//         select: "firstname lastname mobileNumber interestedCourses branchId createdAt email courseId interestedSubjects",
//         populate: [
//           includeCourseDetails === "true" ? {
//             path: "courseId",
//             model: "Course",
//             select: "CourseName CourseID"
//           } : null,
//           {
//             path: "interestedSubjects",
//             model: "Subject",
//             select: "SubjectName SubjectId" // Again, adjust to your schema
//           }
//         ].filter(Boolean)
//       })
//       .select("assignedEnquiries followUps branchId firstName lastName _id");

//     // Format the response for easier consumption on frontend
//     const formattedResponse = telecallers.map(telecaller => {
//       return {
//         _id: telecaller._id,
//         firstName: telecaller.firstName,
//         lastName: telecaller.lastName,
//         branchId: telecaller.branchId,
//         assignedEnquiries: telecaller.assignedEnquiries,
//         followUps: telecaller.followUps.map(followUp => {
//           // Make sure we have all necessary data
//           if (followUp.enquiryId) {
//             return {
//               ...followUp.toObject(),
//               enquiryDetails: {
//                 _id: followUp.enquiryId._id,
//                 firstname: followUp.enquiryId.firstname,
//                 lastname: followUp.enquiryId.lastname,
//                 email: followUp.enquiryId.email,
//                 mobileNumber: followUp.enquiryId.mobileNumber,
//                 branchId: followUp.enquiryId.branchId,
//                 createdAt: followUp.enquiryId.createdAt,
//                 // Include course details if available
//                 course: followUp.enquiryId.courseId ? {
//                   id: followUp.enquiryId.courseId._id,
//                   name: followUp.enquiryId.courseId.CourseName,
//                   code: followUp.enquiryId.courseId.CourseID
//                 } : null
//               }
//             };
//           }
//           return followUp;
//         })
//       };
//     });

//     console.log("Formatted telecallers data for frontend", formattedResponse);
//     res.json({ followUps: formattedResponse });
//   } catch (error) {
//     console.error("Error fetching follow-ups:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// });


// app.get("/api/followups", async (req, res) => {
//   try {
//     const { branchId, includeCourseDetails } = req.query;

//     let filter = { role: { $in: ["Telecaller"] } }; // Only telecallers
//     if (branchId) {
//       filter.branchId = branchId;
//     }

//     const telecallers = await Faculty.find(filter)
//       // .populate({
//       //   path: "assignedEnquiries",
//       //   select: "firstname lastname mobileNumber interestedCourses branchId createdAt email _id courseId",
//       //   // Add course population for assigned enquiries
//       //   populate: includeCourseDetails === "true" ? {
//       //     path: "courseId",
//       //     model: "Course",
//       //     select: "CourseName courseCode CourseID"
//       //   } : undefined
//       // })
//       // .populate({
//       //   path: "followUps.enquiryId",
//       //   model: "Enquiry",
//       //   select: "firstname lastname mobileNumber interestedCourses branchId createdAt email courseId",
//       //   populate: includeCourseDetails === "true" ? {
//       //     path: "courseId", 
//       //     model: "Course",
//       //     select: "CourseName CourseID"
//       //   } : undefined
//       // })
//       // .select("assignedEnquiries followUps branchId firstName lastName _id");
//       .populate({
//         path: "assignedEnquiries",
//         select: "firstname lastname mobileNumber interestedCourses branchId createdAt email _id courseId interestedSubjects MasterBranchID",
//         populate: [
//           includeCourseDetails === "true" ? {
//             path: "courseId",
//             model: "Course",
//             select: "CourseName courseCode CourseID"
//           } : null,
//           {
//             path: "interestedSubjects",
//             model: "Subject",
//             select: "SubjectName SubjectId" // Adjust field names as per your Subject schema
//           }
//         ].filter(Boolean)
//       })
//       .populate({
//         path: "followUps.enquiryId",
//         model: "Enquiry",
//         select: "firstname lastname mobileNumber interestedCourses branchId createdAt email courseId interestedSubjects",
//         populate: [
//           includeCourseDetails === "true" ? {
//             path: "courseId",
//             model: "Course",
//             select: "CourseName CourseID",
//             MasterBranchID:"MasterBranchID",
//           } : null,
//           {
//             path: "interestedSubjects",
//             model: "Subject",
//             select: "SubjectName SubjectId" // Again, adjust to your schema
//           }
//         ].filter(Boolean)
//       })
//       .select("assignedEnquiries followUps branchId firstName lastName _id");

//     // Format the response for easier consumption on frontend
//     const formattedResponse = telecallers.map(telecaller => {
//       return {
//         _id: telecaller._id,
//         firstName: telecaller.firstName,
//         lastName: telecaller.lastName,
//         branchId: telecaller.branchId,
//         assignedEnquiries: telecaller.assignedEnquiries,
//         followUps: telecaller.followUps.map(followUp => {
//           // Make sure we have all necessary data
//           if (followUp.enquiryId) {
//             return {
//               ...followUp.toObject(),
//               enquiryDetails: {
//                 _id: followUp.enquiryId._id,
//                 firstname: followUp.enquiryId.firstname,
//                 lastname: followUp.enquiryId.lastname,
//                 email: followUp.enquiryId.email,
//                 mobileNumber: followUp.enquiryId.mobileNumber,
//                 branchId: followUp.enquiryId.branchId,
//                 createdAt: followUp.enquiryId.createdAt,
//                 MasterBranchID: followUp.enquiryId.MasterBranchID,
//                 // Include course details if available
//                 course: followUp.enquiryId.courseId ? {
//                   id: followUp.enquiryId.courseId._id,
//                   name: followUp.enquiryId.courseId.CourseName,
//                   code: followUp.enquiryId.courseId.CourseID
//                 } : null
//               }
//             };
//           }
//           return followUp;
//         })
//       };
//     });

//     console.log("Formatted telecallers data for frontend", formattedResponse);
//     res.json({ followUps: formattedResponse });
//   } catch (error) {
//     console.error("Error fetching follow-ups:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// });

// app.get("/api/followups", async (req, res) => {
//   try {
//     const { branchId, includeCourseDetails } = req.query;

//     let filter = { role: { $in: ["Telecaller"] } }; // Only telecallers
//     if (branchId) {
//       filter.branchId = branchId;
//     }

//     const telecallers = await Faculty.find(filter)
   
//       .populate({
//         path: "assignedEnquiries",
//         select: "firstname lastname mobileNumber interestedCourses branchId createdAt email _id courseId interestedSubjects MasterBranchID",
//         populate: [
//           includeCourseDetails === "true" ? {
//             path: "courseId",
//             model: "Course",
//             select: "CourseName courseCode CourseID"
//           } : null,
//           {
//             path: "interestedSubjects",
//             model: "Subject",
//             select: "SubjectName SubjectId" // Adjust field names as per your Subject schema
//           }
//         ].filter(Boolean)
//       })
//       .populate({
//         path: "followUps.enquiryId",
//         model: "Enquiry",
//         select: "firstname lastname mobileNumber interestedCourses branchId createdAt email courseId interestedSubjects",
//         populate: [
//           includeCourseDetails === "true" ? {
//             path: "courseId",
//             model: "Course",
//             select: "CourseName CourseID",
//             MasterBranchID:"MasterBranchID",
//           } : null,
//           {
//             path: "interestedSubjects",
//             model: "Subject",
//             select: "SubjectName SubjectId" // Again, adjust to your schema
//           }
//         ].filter(Boolean)
//       })
//       .select("assignedEnquiries followUps branchId firstName lastName _id");

//     // Format the response for easier consumption on frontend
//     const formattedResponse = telecallers.map(telecaller => {
//       return {
//         _id: telecaller._id,
//         firstName: telecaller.firstName,
//         lastName: telecaller.lastName,
//         branchId: telecaller.branchId,
//         assignedEnquiries: telecaller.assignedEnquiries,
//         followUps: telecaller.followUps.map(followUp => {
//           // Make sure we have all necessary data
//           if (followUp.enquiryId) {
//             return {
//               ...followUp.toObject(),
//               enquiryDetails: {
//                 _id: followUp.enquiryId._id,
//                 firstname: followUp.enquiryId.firstname,
//                 lastname: followUp.enquiryId.lastname,
//                 email: followUp.enquiryId.email,
//                 mobileNumber: followUp.enquiryId.mobileNumber,
//                 branchId: followUp.enquiryId.branchId,
//                 createdAt: followUp.enquiryId.createdAt,
//                 MasterBranchID: followUp.enquiryId.MasterBranchID,
//                 // Include course details if available
//                 courses: Array.isArray(followUp.enquiryId.courseId)
//   ? followUp.enquiryId.courseId.map(course => ({
//       id: course._id,
//       name: course.CourseName,
//       code: course.CourseID
//     }))
//   : []

//               }
//             };
//           }
//           return followUp;
//         })
//       };
//     });

//     console.log("Formatted telecallers data for frontend", formattedResponse);
//     res.json({ followUps: formattedResponse });
//   } catch (error) {
//     console.error("Error fetching follow-ups:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// });
app.get("/api/followups", async (req, res) => {
  try {
    const { branchId, includeCourseDetails } = req.query;

    // Filter only telecallers
    let filter = {
      role: { $in: ["Telecaller"] }
    };

    // Branch filter
    if (branchId) {
      filter.branchId = branchId;
    }

    // Optimized query
    const telecallers = await Faculty.find(filter)
      .lean()

      // Assigned Enquiries
      .populate({
        path: "assignedEnquiries",

        options: { lean: true },

        select:
          "firstname lastname mobileNumber interestedCourses branchId createdAt email _id courseId interestedSubjects MasterBranchID assignedTo assignedToName",

        populate: [
          includeCourseDetails === "true"
            ? {
                path: "courseId",
                model: "Course",
                select: "CourseName courseCode CourseID"
              }
            : null,

          {
            path: "interestedSubjects",
            model: "Subject",
            select: "SubjectName SubjectId"
          }
        ].filter(Boolean)
      })

      // Followup Enquiries
      .populate({
        path: "followUps.enquiryId",

        model: "Enquiry",

        options: { lean: true },

        select:
          "firstname lastname mobileNumber interestedCourses branchId createdAt email courseId interestedSubjects MasterBranchID assignedTo assignedToName",

        populate: [
          includeCourseDetails === "true"
            ? {
                path: "courseId",
                model: "Course",
                select: "CourseName CourseID"
              }
            : null,

          {
            path: "interestedSubjects",
            model: "Subject",
            select: "SubjectName SubjectId"
          }
        ].filter(Boolean)
      })

      // Only required telecaller fields
      .select(
        "assignedEnquiries followUps branchId firstName lastName _id"
      );

    // Response
    res.json({
      followUps: telecallers
    });

  } catch (error) {
    console.error("Error fetching follow-ups:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
});





app.put("/api/reassign-enquiry", async (req, res) => {
  try {
    const { enquiryId, oldTelecallerId, newTelecallerId } = req.body;

    console.log(`Reassigning enquiry ${enquiryId} from ${oldTelecallerId} to ${newTelecallerId}`);

    // Update Enquiry with the new telecaller's ObjectId
    const enquiry = await Enquiry.findByIdAndUpdate(
      enquiryId,
      { assignedTo: newTelecallerId }, // Using assignedTo field
      { new: true } // Return the updated document
    );

    if (!enquiry) {
      return res.status(404).json({ error: "Enquiry not found" });
    }

    console.log("Updated enquiry:", enquiry);

    // Remove from old telecaller's assigned enquiries
    if (oldTelecallerId) {
      const oldTelecaller = await Faculty.findByIdAndUpdate(
        oldTelecallerId,
        { $pull: { assignedEnquiries: enquiryId } },
        { new: true }
      );
      console.log("Updated old telecaller:", oldTelecaller);
    }

    // Add to new telecaller's assigned enquiries
    const newTelecaller = await Faculty.findByIdAndUpdate(
      newTelecallerId,
      { $push: { assignedEnquiries: enquiryId } },
      { new: true }
    );

    console.log("Updated new telecaller:", newTelecaller);

    res.json({
      message: "Enquiry reassigned successfully",
      enquiry: enquiry
    });
  } catch (err) {
    console.error("Error reassigning enquiry:", err);
    res.status(500).json({ error: "Error reassigning enquiry", details: err.message });
  }
});
app.put("/api/reassign-branch", async (req, res) => {
  try {
    const { enquiryId, newBranchId } = req.body;

    if (!enquiryId || !newBranchId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Verify the branch exists
    const branchExists = await Branch.findOne({ branchId: newBranchId });
    if (!branchExists) {
      return res.status(404).json({ message: "Selected branch not found" });
    }

    // Update the enquiry with new branch ID
    // Also set status back to 'unassigned' since it's moving to a new branch
    // and will need to be assigned to a telecaller in that branch
    const updatedEnquiry = await Enquiry.findByIdAndUpdate(
      enquiryId,
      {
        branchId: newBranchId,
        status: 'unassigned',
        assignedTo: null  // Clear the assigned telecaller
      },
      { new: true }
    );

    if (!updatedEnquiry) {
      return res.status(404).json({ message: "Enquiry not found" });
    }

    return res.status(200).json({
      message: "Branch reassigned successfully",
      enquiry: updatedEnquiry
    });
  } catch (error) {
    console.error("Error reassigning branch:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

app.get('/api/next-registration-id/:branchId', async (req, res) => {
  try {
    const { branchId } = req.params;

    // Count existing registrations for this branch
    const count = await Registration.countDocuments({ branchId });

    // Generate next ID (branchId-count+1)
    // Format: branchId-XX where XX is the sequence number padded to 2 digits
    const sequenceNumber = String(count + 1).padStart(5, '0');
    const nextRegId = `${branchId.toUpperCase()}-${sequenceNumber}`;

    res.json({ regid: nextRegId });
  } catch (error) {
    console.error('Error generating next registration ID:', error);
    res.status(500).json({ message: 'Error generating registration ID' });
  }
});
// app.post("/api/newregistration",
//   upload.fields([{ name: "aadhar" }, { name: "resume" }, { name: "profilePhoto" }]),
//   async (req, res) => {
//     try {
//       console.log("Received Data:", req.body);
//       console.log("Received Files:", req.files);

//       // Hash the password before saving
//       const salt = await bcrypt.genSalt(10);
//       const hashedPassword = await bcrypt.hash(req.body.password, salt);

//       // Generate new regid using the Counter collection (atomic increment)
//       // const regCounter = await Counter.findOneAndUpdate(
//       //   { _id: "regid" },          // Look for an existing counter document
//       //   { $inc: { seq: 1 } },       // Increment the counter
//       //   { new: true, upsert: true } // Return the updated document; create one if it doesn’t exist
//       // );
//       // const newRegId = `cad${String(regCounter.seq).padStart(2, "0")}`;

//       // Optional: Remove the duplicate check if the counter guarantees uniqueness.
//       // (If you still want to check, you can keep the following, but it should rarely trigger.)
//       // const existingUser = await Registration.findOne({ regid: newRegId });
//       // if (existingUser) {
//       //   return res.status(400).json({ message: "Registration ID already exists. Try again." });
//       // }

//       // Build full file paths for uploaded files
//       const aadharPath = req.files?.["aadhar"]?.[0] ? `uploads\\${req.files["aadhar"][0].filename}` : "";
//       const resumePath = req.files?.["resume"]?.[0] ? `uploads\\${req.files["resume"][0].filename}` : "";
//       const profilePhoto = req.files?.["profilePhoto"]?.[0] ? `uploads\\${req.files["resume"][0].filename}` : "";
//       // Create a new registration with the generated regid
//       const branch = await Branch.findOne({ branchId: req.body.branchId });
//       if (!branch) {
//         return res.status(404).json({ message: 'Branch not found' });
//       }
//       const newRegistration = new Registration({
//         ...req.body,
//         // regid: regid,
//         // password: hashedPassword,
//         aadhar: aadharPath,
//         resume: resumePath,
//         masterBranchId: await MasterBranch.findOne({ BranchesID: branch._id }),
//         profilePhoto: profilePhoto,
//         formStatus: "Success",
//         regStatus: "Pending"
//       });
//       console.log("whike svaiung", newRegistration)
//       await newRegistration.save();
//       res.json({ message: "Registration successful!" });
//     } catch (error) {
//       console.error("Error in /api/newregistration:", error);
//       res.status(500).json({ message: "Internal Server Error", error: error.message });
//     }
//   }
// );
app.post('/api/newregistration', upload.fields([
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'aadhar', maxCount: 1 },
  { name: 'resume', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log("Received Data:", req.body);
    console.log("Received Files:", req.files);

    // FIXED: Clean up paymentsPlan array - remove empty strings and invalid entries
    let paymentsPlan = [];
    if (req.body.paymentsPlan && Array.isArray(req.body.paymentsPlan)) {
      paymentsPlan = req.body.paymentsPlan.filter(plan => {
        return plan && 
               typeof plan === 'object' && 
               plan !== "" && 
               plan.dueDate && 
               plan.amount &&
               String(plan.dueDate).trim() !== "" &&
               String(plan.amount).trim() !== "";
      });
    }

    // Generate registration ID
    const lastRegistration = await Registration.findOne().sort({ regid: -1 });
    let newRegId;
    if (lastRegistration && lastRegistration.regid) {
      const lastNumber = parseInt(lastRegistration.regid.replace('REG', ''));
      newRegId = `REG${String(lastNumber + 1).padStart(3, '0')}`;
    } else {
      newRegId = 'REG001';
    }

    // FIXED: Handle password - generate random password if not provided
    let hashedPassword = "";
    if (req.body.password && req.body.password.trim() !== "") {
      hashedPassword = await bcrypt.hash(req.body.password, 10);
    } else {
      // Generate random password if not provided
      const randomPassword = Math.random().toString(36).slice(-8);
      hashedPassword = await bcrypt.hash(randomPassword, 10);
      console.log("Generated random password:", randomPassword);
    }

    // FIXED: Step 1 - Find the branch by branchId (string like "R101")
    console.log("Looking for branch with ID:", req.body.branchId);
    const branch = await Branch.findOne({ branchId: req.body.branchId });
    
    if (!branch) {
      console.log("Branch not found with ID:", req.body.branchId);
      return res.status(400).json({ 
        message: "Invalid branch ID", 
        branchId: req.body.branchId 
      });
    }

    console.log("Found branch:", branch);

    // FIXED: Step 2 - Find master branch using the branch's ObjectId
    const masterBranch = await MasterBranch.findOne({
      BranchesID: { $in: [branch._id] }  // Now using ObjectId
    });

    if (!masterBranch) {
      console.log("Master branch not found for branch ObjectId:", branch._id);
      return res.status(400).json({ 
        message: "Master branch not found for this branch",
        branchId: req.body.branchId,
        branchObjectId: branch._id
      });
    }

    console.log("Found master branch:", masterBranch);

    // Handle file uploads
    let profilePhotoPath = "";
    if (req.files && req.files.profilePhoto) {
      profilePhotoPath = req.files.profilePhoto[0].path;
    }

    // Create registration data
    const registrationData = {
      // regid: newRegId,
      fName: req.body.fName,
      lName: req.body.lName || "",
      guardianName: req.body.guardianName,
      contactAddress: req.body.contactAddress,
      email: req.body.email,
      city: req.body.city,
      state: req.body.state,
      qualification: req.body.qualification,
      otherQualification: req.body.otherQualification || "",
      collegeName: req.body.collegeName,
      phone: req.body.phone,
      source: req.body.source,
      branchId: req.body.branchId,        // Keep original string branchId
      courseTypeId: req.body.courseTypeId,
      courseId: req.body.courseId,
      courseName: req.body.courseName,
      selectedSubjects: req.body.selectedSubjects || [],
      courseFee: req.body.courseFee || "",
      masterBranchId: masterBranch._id,    // Use ObjectId
      joiningDate: req.body.joiningDate || "",
      profilePhoto: profilePhotoPath,
      feeType: req.body.feeType || "Single",
      installmentCount: req.body.installmentCount || 0,
      offeredFee: req.body.offeredFee,
      paymentsPlan: paymentsPlan,
      password: hashedPassword,
      formStatus: "Success"
    };

    console.log("Cleaned paymentsPlan:", paymentsPlan);
    console.log("Registration data to save:", registrationData);

    const newRegistration = new Registration(registrationData);
    const savedRegistration = await newRegistration.save();

    res.status(201).json({
      message: "Registration successful!",
      registration: savedRegistration
    });

  } catch (error) {
    console.error("Error in /api/newregistration:", error);
    res.status(500).json({ 
      message: "Registration failed", 
      error: error.message 
    });
  }
});



app.put("/api/registration/:id", async (req, res) => {
  console.log("userdata updated", req.body);
  try {
    let updateData = req.body;
    let registrationIdGenerated = false;
    let plainPassword = null;

    // Only generate regid if status is Approved and there's no existing regid
    if (updateData.regStatus === 'Approved' && !updateData.regid) {
      const branchId = updateData.branchId.toUpperCase();

      // Find all registrations for this branch with regid
      const existingRegistrations = await Registration.find({
        regid: new RegExp(`^${branchId}-\\d{5}$`), // Matches pattern like "B-01", "B-02", etc.
        regStatus: 'Approved'
      }).select('regid');

      // Extract sequence numbers and find the highest
      let highestSeq = 0;

      if (existingRegistrations.length > 0) {
        existingRegistrations.forEach(reg => {
          if (reg.regid) {
            // Extract the number part after the hyphen
            const parts = reg.regid.split('-');
            if (parts.length === 2) {
              const seqNum = parseInt(parts[1], 10);
              if (!isNaN(seqNum) && seqNum > highestSeq) {
                highestSeq = seqNum;
              }
            }
          }
        });
      }
        console.log("high",highestSeq)

      // Generate next ID by incrementing the highest sequence number
      const nextSeq = highestSeq + 1;
    
      const sequenceNumber = String(nextSeq).padStart(5, '0');
      const nextRegId = `${branchId}-${sequenceNumber}`;

      // Generate a random password
      plainPassword = generateRandomPassword(); // You'll need to implement this function

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(plainPassword, salt);
      // If you're using bcrypt or another hashing library for passwords
      // const hashedPassword = await bcrypt.hash(plainPassword, 10);

      // Add regid and password to the update data
      updateData.regid = nextRegId;
      updateData.password = hashedPassword; // or hashedPassword if you're hashing

      registrationIdGenerated = true;
    }

    const updatedRegistration = await Registration.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true } // Return the updated document
    );

    // Send email if registration ID was generated
    if (registrationIdGenerated && updatedRegistration.email) {
      try {
        // Email sending code...
        await sendRegistrationEmail(
          updatedRegistration.email,
          updatedRegistration.fName,
          updatedRegistration.regid,
          updatedRegistration.courseName,
          plainPassword // Now passing the generated password to the email function
        );
        console.log(`Registration email sent to ${updatedRegistration.email}`);
      } catch (emailError) {
        console.error("Error sending registration email:", emailError);
        // Continue with the response even if email fails
      }
    }

    res.json({
      message: "Registration updated successfully!",
      regid: updateData.regid // Return the regid so frontend knows what was assigned
    });
  } catch (error) {
    console.error("Error updating registration:", error);
    res.status(500).json({ message: "Error updating registration", error });
  }
});

// Function to generate a random password
function generateRandomPassword(length = 8) {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let password = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    password += charset[randomIndex];
  }
  return password;
}

// Email sending function (implement using your preferred email service)
// async function sendRegistrationEmail(email, studentName, regId, courseName, plainPassword) {
//   // Here's an example using nodemailer
//   // You'll need to install nodemailer: npm install nodemailer



//   // Create a transporter (configure with your email service details)
//   const transporter = nodemailer.createTransport({
//     service: 'gmail',  // or your email service
//     auth: {
//       user: 'sree.excerpt@gmail.com',
//       pass: 'pzbn idce nlso wate'  // Use app password if using Gmail with 2FA
//     }
//   });

//   // Email content
//   const mailOptions = {
//     from: 'your-email@example.com',
//     to: email,
//     subject: 'Registration Successful!',
//     html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//           <h2>Registration Successful!</h2>
//           <p>Dear ${studentName},</p>
//           <p>Your registration has been approved. Here are your registration details:</p>
//           <ul>
//             <li><strong>Registration ID:</strong> ${regId}</li>
//             <li><strong>Course:</strong> ${courseName}</li>
//               <li><strong>Password:</strong> ${plainPassword}</li>
//           </ul>
//           <p>Please keep your registration ID for future reference.</p>
//           <a>https://caddesk.in/</a>
//           <p>Thank you for enrolling with us.</p>
//           <p>Best regards,<br>CADDESK  HYDERABAD</p>
//         </div>
//       `
//   };

//   // Send email
//   return transporter.sendMail(mailOptions);
// }
async function sendRegistrationEmail(email, studentName, regId, courseName, plainPassword) {
  // Here's an example using nodemailer
  // You'll need to install nodemailer: npm install nodemailer



  // Create a transporter (configure with your email service details)
 const transporter = nodemailer.createTransport({
  host: 'smtp.hostinger.com', // Use smtp.hostinger.com, not mail.hostinger.com
  port: 465,
  secure: true, // SSL
  auth: {
    user: 'info@jbkacademy.in', // Lowercase recommended
    pass: 'Karthik@9581766526',
  },
  logger: true,
  debug: true
});

  // Email content
const mailOptions = {
  from: '"JBK Academy" <info@jbkacademy.in>',
  to: email,
  subject: 'Registration Confirmation - JBK Academy',
  html: `
    <div style="font-family: 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; background-color: #ffffff; line-height: 1.6;">
      
      <!-- Header Section -->
      <div style="background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); padding: 40px 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 32px; font-weight: 300; letter-spacing: 1px;">
          JBK ACADEMY
        </h1>
        <p style="color: #e8f4f8; margin: 8px 0 0 0; font-size: 14px; font-weight: 300; letter-spacing: 0.5px;">
          Excellence in Education
        </p>
      </div>

      <!-- Main Content -->
      <div style="padding: 40px 30px; background-color: #ffffff;">
        
        <!-- Success Message -->
        <div style="text-align: center; margin-bottom: 35px;">
          <div style="display: inline-block; background-color: #e8f5e8; border-radius: 50%; width: 60px; height: 60px; line-height: 60px; margin-bottom: 20px;">
            <span style="color: #27ae60; font-size: 24px;">✓</span>
          </div>
          <h2 style="color: #2c3e50; margin: 0; font-size: 26px; font-weight: 400; letter-spacing: 0.5px;">
            Registration Confirmed
          </h2>
        </div>

        <!-- Personal Greeting -->
        <div style="margin-bottom: 30px;">
          <p style="font-size: 16px; color: #2c3e50; margin: 0; font-weight: 400;">
            Dear <strong>${studentName}</strong>,
          </p>
        </div>
        
        <p style="font-size: 16px; color: #34495e; margin-bottom: 30px; font-weight: 300; line-height: 1.7;">
          We are pleased to confirm that your registration with JBK Academy has been successfully processed and approved. 
          Please find your enrollment details below for your records.
        </p>

        <!-- Registration Details Card -->
        <div style="border: 1px solid #e1e8ed; border-radius: 8px; overflow: hidden; margin: 30px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
          <div style="background-color: #f8f9fa; padding: 20px; border-bottom: 1px solid #e1e8ed;">
            <h3 style="margin: 0; color: #2c3e50; font-size: 18px; font-weight: 500;">Registration Details</h3>
          </div>
          <div style="padding: 25px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #f1f3f4; width: 35%;">
                  <span style="color: #6c757d; font-size: 14px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Registration ID</span>
                </td>
                <td style="padding: 12px 0; border-bottom: 1px solid #f1f3f4;">
                  <span style="color: #2c3e50; font-size: 16px; font-weight: 400; font-family: 'Courier New', monospace; background-color: #f8f9fa; padding: 4px 8px; border-radius: 4px;">${regId}</span>
                </td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #f1f3f4;">
                  <span style="color: #6c757d; font-size: 14px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Course Enrolled</span>
                </td>
                <td style="padding: 12px 0; border-bottom: 1px solid #f1f3f4;">
                  <span style="color: #2c3e50; font-size: 16px; font-weight: 500;">${courseName}</span>
                </td>
              </tr>
              <tr>
                <td style="padding: 12px 0;">
                  <span style="color: #6c757d; font-size: 14px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Login Password</span>
                </td>
                <td style="padding: 12px 0;">
                  <span style="color: #2c3e50; font-size: 16px; font-weight: 400; font-family: 'Courier New', monospace; background-color: #fff3cd; padding: 6px 10px; border-radius: 4px; border: 1px solid #ffeaa7;">${plainPassword}</span>
                </td>
              </tr>
            </table>
          </div>
        </div>

        <!-- Security Notice -->
        <div style="background-color: #f8f9fa; border-left: 4px solid #3498db; padding: 20px; margin: 30px 0; border-radius: 0 6px 6px 0;">
          <p style="margin: 0; color: #495057; font-size: 14px; font-weight: 400;">
            <strong style="color: #2c3e50;">Important:</strong> Please store your registration ID and password securely. 
          
          </p>
        </div>


        <!-- Website Button -->
        <div style="text-align: center; margin: 40px 0;">
          <a href="https://jbkacademy.in/" target="_blank" 
             style="display: inline-block; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); 
                    color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; 
                    font-weight: 500; font-size: 16px; letter-spacing: 0.5px; box-shadow: 0 3px 10px rgba(52, 152, 219, 0.3);">
           Visit Our Website
          </a>
        </div>

      </div>

      <!-- Footer Section -->
      <div style="background-color: #2c3e50; padding: 35px 30px; color: #ffffff;">
        
        <!-- Contact Information -->
        <div style="text-align: center; margin-bottom: 25px;">
          <h3 style="color: #ffffff; font-size: 18px; font-weight: 400; margin-bottom: 15px; letter-spacing: 0.5px;">
            Contact Information
          </h3>
          <p style="margin: 8px 0; font-size: 16px; font-weight: 300;">
            <span style="color: #bdc3c7;">Phone:</span> 
            <a href="tel:+919985023100" style="color: #74b9ff; text-decoration: none; font-weight: 400;">+91 99850 23100</a>
          </p>
          <p style="margin: 8px 0; font-size: 16px; font-weight: 300;">
            <span style="color: #bdc3c7;">Email:</span> 
            <a href="mailto:info@jbkacademy.in" style="color: #74b9ff; text-decoration: none; font-weight: 400;">info@jbkacademy.in</a>
          </p>
          <p style="margin: 8px 0; font-size: 16px; font-weight: 300;">
            <span style="color: #bdc3c7;">Website:</span> 
            <a href="https://jbkacademy.in/" target="_blank" style="color: #74b9ff; text-decoration: none; font-weight: 400;">jbkacademy.in</a>
          </p>
        </div>

        <!-- Social Media -->
        <div style="text-align: center; margin: 25px 0; padding-top: 20px; border-top: 1px solid #34495e;">
          <p style="margin-bottom: 15px; font-size: 14px; color: #bdc3c7; font-weight: 300; letter-spacing: 0.5px;">
            CONNECT WITH US
          </p>
          <div>
            <a href="https://m.facebook.com/p/JBK-Academy-Hyderabad" target="_blank" style="text-decoration: none; margin: 0 12px; display: inline-block;">
              <div style="width: 40px; height: 40px; background-color: #3b5998; border-radius: 50%; display: inline-block; line-height: 40px; text-align: center;">
                <span style="color: #ffffff; font-size: 18px; font-weight: bold;">f</span>
              </div>
            </a>
            <a href="https://www.instagram.com/jbk_academy/?hl=en" target="_blank" style="text-decoration: none; margin: 0 10px; display: inline-block;">
              <div style="width: 40px; height: 40px; background: linear-gradient(45deg, #f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%); border-radius: 50%; display: inline-block; line-height: 40px; text-align: center;">
                <span style="color: #ffffff; font-size: 16px; font-weight: bold;">Insta</span>
              </div>
            </a>
            <a href="https://www.linkedin.com/company/jbk-academy" target="_blank" style="text-decoration: none; margin: 0 12px; display: inline-block;">
              <div style="width: 40px; height: 40px; background-color: #0077b5; border-radius: 50%; display: inline-block; line-height: 40px; text-align: center;">
                <span style="color: #ffffff; font-size: 16px; font-weight: bold;">in</span>
              </div>
            </a>
            <a href="https://m.youtube.com/channel/UCSxp1XWEBEfWDhsiUCGYJ7A" target="_blank" style="text-decoration: none; margin: 0 12px; display: inline-block;">
              <div style="width: 40px; height: 40px; background-color: #ff0000; border-radius: 50%; display: inline-block; line-height: 40px; text-align: center;">
                <span style="color: #ffffff; font-size: 14px; font-weight: bold;">▶</span>
              </div>
            </a>
            <a href="https://wa.me/919985023100" target="_blank" style="text-decoration: none; margin: 0 12px; display: inline-block;">
              <div style="width: 40px; height: 40px; background-color: #25d366; border-radius: 50%; display: inline-block; line-height: 40px; text-align: center;">
                <span style="color: #ffffff; font-size: 16px; font-weight: bold;">W</span>
              </div>
            </a>
          </div>
        </div>

        <!-- Signature -->
        <div style="text-align: center; padding-top: 25px; border-top: 1px solid #34495e;">
          <p style="margin: 0; font-size: 15px; color: #bdc3c7; font-weight: 300;">
            Thank you for choosing JBK Academy for your educational journey.
          </p>
          <p style="margin: 10px 0 0 0; font-size: 16px; color: #ffffff; font-weight: 400; letter-spacing: 0.5px;">
            <strong>JBK ACADEMY HYDERABAD</strong>
          </p>
        </div>

      </div>

      <!-- Legal Footer -->
      <div style="background-color: #1a252f; padding: 15px 30px; text-align: center;">
        <p style="margin: 0; font-size: 12px; color: #7f8c8d; font-weight: 300;">
          This is an automated message. Please do not reply to this email.
        </p>
      </div>

    </div>
  `
};
return transporter.sendMail(mailOptions);
}

// app.get("/api/registrations", async (req, res) => {
//   try {
//     const query = buildBranchQuery(req.user, req.query.branchId);
//     if (req.query.masterBranchId) {
//       query.masterBranchId = req.query.masterBranchId;
//     }
//     if (req.query.regStatus) {
//       query.regStatus = req.query.regStatus;
//     }

//     const details = String(req.query.details) === 'true';
//     const all = String(req.query.all) === 'true';
//     const page = Math.max(Number(req.query.page) || 1, 1);
//     const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
//     const skip = (page - 1) * limit;

//     const baseQuery = Registration.find(query).sort({ createdAt: -1 });

//     if (!details) {
// baseQuery.select(`
//    regid
//   fName
//   lName
//   email
//   phone
//   qualification
//   otherQualification
//   education
//   highestQualification
//   courseName
//   regStatus
//   branchId
//   masterBranchId
//   singlePaymentStatus
//   selectedSubjects
//   courseId
//   courseTypeId
//   paymentsPlan
//   offeredFee
//   totalPaid
//   createdAt
//   approvedAt
// `);    }

//     if (!all) {
//       baseQuery.skip(skip).limit(limit);
//     }

//     baseQuery
//   .populate('masterBranchId', 'MasterBranchName')
//   .populate('courseTypeId', 'CourseTypeName')
//   .populate({
//     path: 'selectedSubjects',
//     model: 'Subject',
//     select: 'SubjectName SubjectId SubjectCaption SubjectDesc'
//   });

//     baseQuery.lean();
//     const [registrations, total] = await Promise.all([
//       baseQuery,
//       Registration.countDocuments(query),
//     ]);

//     res.json({ total, page, limit: all ? total : limit, registrations });
//   } catch (error) {
//     console.error("Error fetching registrations:", error);
//     res.status(500).json({ message: "Error fetching registrations", error });
//   }
// });




app.get("/api/registrations", async (req, res) => {
  try {
    // Build query
    const query = buildBranchQuery(
      req.user,
      req.query.branchId
    );

    // Master branch filter
    if (req.query.masterBranchId) {
      query.masterBranchId =
        req.query.masterBranchId;
    }

    // Registration status filter
    if (req.query.regStatus) {
      query.regStatus = req.query.regStatus;
    }

    // Query params
    const details =
      String(req.query.details) === "true";

    const all =
      String(req.query.all) === "true";

    const page = Math.max(
      Number(req.query.page) || 1,
      1
    );

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 20, 1),
      100
    );

    const skip = (page - 1) * limit;

    // Base query
    const baseQuery = Registration.find(query)

      // PERFORMANCE BOOST
      .sort({ createdAt: -1 })

      // PERFORMANCE BOOST
      .lean();

    // Select only needed fields
    if (!details) {
      baseQuery.select(`
        regid
        fName
        lName
        email
        phone
        qualification
        otherQualification
        education
        highestQualification
        courseName
        regStatus
        branchId
        masterBranchId
        singlePaymentStatus
        selectedSubjects
        courseId
        courseTypeId
        paymentsPlan
        offeredFee
        totalPaid
        createdAt
        approvedAt
      `);
    }

    // Pagination
    if (!all) {
      baseQuery.skip(skip).limit(limit);
    }

    // Populates
    baseQuery

      // Master Branch
      .populate({
        path: "masterBranchId",
        select: "MasterBranchName"
      })

      // Course Type
      .populate({
        path: "courseTypeId",
        select: "CourseTypeName"
      })

      // Subjects
      .populate({
        path: "selectedSubjects",
        model: "Subject",
        select: "SubjectName SubjectId SubjectCaption SubjectDesc"
      });

    // Execute in parallel
    const [registrations, total] =
      await Promise.all([
        baseQuery,
        Registration.countDocuments(query),
      ]);

    // Response
    res.json({
      total,
      page,
      limit: all ? total : limit,
      registrations,
    });

  } catch (error) {
    console.error(
      "Error fetching registrations:",
      error
    );

    res.status(500).json({
      message: "Error fetching registrations",
      error,
    });
  }
});

// app.get("/api/registrations/light", async (req, res) => {
//   try {
//     const query = buildBranchQuery(req.user, req.query.branchId);
//     if (req.query.masterBranchId) query.masterBranchId = req.query.masterBranchId;
//     if (req.query.regStatus) query.regStatus = req.query.regStatus;

//     const page = Math.max(Number(req.query.page) || 1, 1);
//     const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

//     const total = await Registration.countDocuments(query);
//     const registrations = await Registration.find(query)
//       // .select(
//       //   "fName lName email mobileNumber courseName regStatus branchId MasterBranchID singlePaymentStatus paymentsPlan createdAt"
//       // )


//       .select(
//   "regid fName lName email mobileNumber courseName regStatus branchId MasterBranchID singlePaymentStatus paymentsPlan createdAt"
// )
//       .sort({ createdAt: -1 })
//       .skip((page - 1) * limit)
//       .limit(limit)
//       .lean();

//     res.json({ total, page, limit, registrations });
//   } catch (error) {
//     console.error("Error fetching lightweight registrations:", error);
//     res.status(500).json({ message: "Error fetching lightweight registrations", error });
//   }
// });



// app.get("/api/registrations/light", async (req, res) => {
//   try {

//     const query = buildBranchQuery(req.user, req.query.branchId);

//     if (req.query.masterBranchId) {
//       query.masterBranchId = req.query.masterBranchId;
//     }

//     if (req.query.regStatus) {
//       query.regStatus = req.query.regStatus;
//     }

//     const page = Math.max(Number(req.query.page) || 1, 1);

//     const limit = Math.min(
//       Math.max(Number(req.query.limit) || 20, 1),
//       100
//     );

//     const total = await Registration.countDocuments(query);

//     // REMOVE select temporarily to get full fields
//     const registrations = await Registration.find(query)
//       .sort({ createdAt: -1 })
//       .skip((page - 1) * limit)
//       .limit(limit)
//       .lean();

//     console.log("LIGHT REGISTRATION SAMPLE:", registrations[0]);

//     res.json({
//       total,
//       page,
//       limit,
//       registrations,
//     });

//   } catch (error) {

//     console.error(
//       "Error fetching lightweight registrations:",
//       error
//     );

//     res.status(500).json({
//       message: "Error fetching lightweight registrations",
//       error,
//     });
//   }
// });




















// app.get("/api/registrations/light", authenticateToken, async (req, res) => {
//   try {

//     let query = {};

//     // Normalize roles
//     const roles = Array.isArray(req.user?.roles)
//       ? req.user.roles
//       : req.user?.role
//       ? [req.user.role]
//       : [];

//     const normalizedRoles = roles.map((r) =>
//       String(r).toLowerCase().replace(/[^a-z0-9]/g, "")
//     );

//     const isSuperAdmin = normalizedRoles.includes("superadmin");

//     // ONLY NON SUPERADMIN
//     if (!isSuperAdmin && req.user?.branchId) {
//       query.branchId = req.user.branchId;
//     }

//     // Optional filters
//     if (req.query.masterBranchId) {
//       query.masterBranchId = req.query.masterBranchId;
//     }

//     if (req.query.regStatus) {
//       query.regStatus = req.query.regStatus;
//     }

//     const page = Math.max(Number(req.query.page) || 1, 1);

//     const limit = Math.min(
//       Math.max(Number(req.query.limit) || 500, 1),
//       1000
//     );

//     const total = await Registration.countDocuments(query);

//     const registrations = await Registration.find(query)
//       .sort({ createdAt: -1 })
//       .skip((page - 1) * limit)
//       .limit(limit)
//       .lean();

//     console.log("TOTAL REGISTRATIONS:", registrations.length);

//     res.json({
//       total,
//       page,
//       limit,
//       registrations,
//     });

//   } catch (error) {

//     console.error(
//       "Error fetching lightweight registrations:",
//       error
//     );

//     res.status(500).json({
//       message: "Error fetching lightweight registrations",
//       error,
//     });
//   }
// });


app.get("/api/registrations/light", authenticateToken, async (req, res) => {
  try {
    let query = {};

    const roles = Array.isArray(req.user?.roles)
      ? req.user.roles
      : req.user?.role ? [req.user.role] : [];

    const normalizedRoles = roles.map((r) =>
      String(r).toLowerCase().replace(/[^a-z0-9]/g, "")
    );

    const isSuperAdmin = normalizedRoles.includes("superadmin");

    if (!isSuperAdmin && req.user?.branchId) {
      query.branchId = req.user.branchId;
    }

    if (req.query.masterBranchId) {
      query.masterBranchId = req.query.masterBranchId;
    }

    // Always default to Approved unless overridden
    query.regStatus = req.query.regStatus || "Approved";

    const page  = Math.max(Number(req.query.page)  || 1,    1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100); // ✅ 10 per page, max 100

    const total = await Registration.countDocuments(query);

    const registrations = await Registration.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    console.log(`Page ${page} | Limit ${limit} | Total ${total} | Returned ${registrations.length}`);

    res.json({ total, page, limit, registrations });

  } catch (error) {
    console.error("Error fetching lightweight registrations:", error);
    res.status(500).json({ message: "Error fetching lightweight registrations", error });
  }
});

app.get('/api/std/batches/light', async (req, res) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;

    const batches = await Batch.find(query)
      .select('assignedStudents batchName status subject completedDate')
      .lean();

    res.json(batches);
  } catch (error) {
    console.error('Error fetching lightweight batches:', error);
    res.status(500).json({ error: 'Failed to fetch lightweight batches' });
  }
});

app.get('/api/new/registrations', async (req, res) => {
  try {
    const { masterBranchId, branchId } = req.query;
    let query = { regStatus: "Approved" };
    
    // If branchId is provided, filter by it
    if (branchId) {
      query.branchId = branchId;
    }
    
    // If only masterBranchId is provided, find all branches in this master branch
    // and then filter registrations by those branch IDs
    else if (masterBranchId) {
      const masterBranch = await MasterBranch.findById(masterBranchId);
      if (!masterBranch) {
        return res.status(404).json({ error: 'Master branch not found' });
      }
      
      // Make sure BranchesID exists and is an array
      if (masterBranch.BranchesID && Array.isArray(masterBranch.BranchesID)) {
        // Find all branches associated with this master branch
        const branches = await Branch.find({
          _id: { $in: masterBranch.BranchesID }
        });
        
        // Extract branchId from each branch
        const branchIds = branches.map(branch => branch.branchId);
        
        // Only add this condition if we found branches
        if (branchIds.length > 0) {
          query.branchId = { $in: branchIds };
        }
      }
    }
    
    const registrations = await Registration.find(query)
      .sort({ createdAt: -1 })
      .lean(); // Use lean for faster reads
    
    res.json(registrations);
  } catch (error) {
    console.error('Error fetching registrations:', error);
    res.status(500).json({ error: 'Failed to fetch registrations' });
  }
});
// Get individual registration by ID
app.get("/api/registration/:id", async (req, res) => {
  try {
    const registration = await Registration.findById(req.params.id);
    if (!registration) {
      return res.status(404).json({ message: "Registration not found" });
    }
    res.json(registration);
  } catch (error) {
    res.status(500).json({ message: "Error fetching registration", error });
  }
});

app.delete("/api/registration/:id", async (req, res) => {
  try {
    console.log("Request to delete registration with ID:", req.params.id);

    // Validate if ID is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      console.log("Invalid ID format");
      return res.status(400).json({ message: "Invalid ID format" });
    }

    const registration = await Registration.findById(req.params.id);
    if (!registration) {
      console.log("Registration not found!");
      return res.status(404).json({ message: "Registration not found" });
    }

    // Check if files exist before trying to delete
    if (registration.aadhar) {
      const aadharPath = path.resolve(registration.aadhar);
      if (fs.existsSync(aadharPath)) {
        fs.unlinkSync(aadharPath);
        console.log("Deleted Aadhar file:", aadharPath);
      } else {
        console.log("Aadhar file not found, skipping:", aadharPath);
      }
    }

    if (registration.resume) {
      const resumePath = path.resolve(registration.resume);
      if (fs.existsSync(resumePath)) {
        fs.unlinkSync(resumePath);
        console.log("Deleted Resume file:", resumePath);
      } else {
        console.log("Resume file not found, skipping:", resumePath);
      }
    }

    await Registration.findByIdAndDelete(req.params.id);
    console.log("Successfully deleted registration!");
    res.json({ message: "Registration deleted successfully!" });

  } catch (error) {
    console.error("Error deleting registration:", error);
    res.status(500).json({ message: "Error deleting registration", error });
  }
});


app.get("/api/studentdownloaddocuments/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const student = await Registration.findById(id);

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=registration_${student.regid}.zip`);

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", (err) => {
      console.error("Archiver error:", err);
      res.status(500).send("Error creating ZIP");
    });

    archive.pipe(res);

    if (student.resume) {
      const resumePath = path.join(__dirname, student.resume.replace(/\\/g, "/")); // handle Windows slashes
      if (fs.existsSync(resumePath)) {
        archive.file(resumePath, { name: "Resume_" + path.basename(resumePath) });
        console.log("✅ Added resume:", resumePath);
      } else {
        console.warn("❌ Resume file not found:", resumePath);
      }
    }

    // Aadhar
    if (student.aadhar) {
      const aadharPath = path.join(__dirname, student.aadhar.replace(/\\/g, "/"));
      if (fs.existsSync(aadharPath)) {
        archive.file(aadharPath, { name: "Aadhar_" + path.basename(aadharPath) });
        console.log("✅ Added aadhar:", aadharPath);
      } else {
        console.warn("❌ Aadhar file not found:", aadharPath);
      }
    }
    await archive.finalize();
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});



app.post("/api/assign-batch", async (req, res) => {
  const { studentId, batchId } = req.body;

  try {
    const batch = await Batch.findById(batchId);
    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    // Check if the batch has available slots
    if (batch.remainingStudentCount > 0) {
      // Add student to the batch
      batch.assignedStudents.push(studentId);
      batch.remainingStudentCount -= 1;
      await batch.save();

      // Optionally, update the student's batch field if necessary
      await Registration.findByIdAndUpdate(studentId, { batch: batchId });

      return res.json({ message: "Batch assigned successfully!", batch });
    } else {
      return res.status(400).json({ error: "No remaining slots in this batch" });
    }
  } catch (error) {
    console.error("Error assigning batch", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/batches/:batchId", async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.batchId);

    if (!batch) {
      return res.status(404).json({ message: "Batch not found" });
    }

    // Ensure assignedStudents is always an array
    batch.assignedStudents = batch.assignedStudents || [];

    res.json(batch);
  } catch (error) {
    console.error("Error fetching batch:", error);
    res.status(500).json({ message: "Server error" });
  }
});



app.get('/api/course-fee/:courseName', async (req, res) => {
  try {
    const { courseName } = req.params;
    console.log("Course Name:", courseName.trim());
    const course = await Course.findOne({ CourseName: courseName.trim() })
      .populate("payment", "single installment") // Populate payment details;

    if (!course) {
      return res.status(400).json({ message: 'Course not found' });
    }
    console.log("Course Details:", course);
    // Return fee structure in both formats to ensure compatibility
    return res.json({
      // Original format for backward compatibility
      fee: course.payment?.single || 0,
      Ifee: course.payment?.installment || 0,
      // New format
      payment: {
        single: course.payment?.single || 0,
        installment: course.payment?.installment || 0
      }
    });
  } catch (error) {
    console.error('Error fetching course fee:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});
app.get("/timetable/:facultyId", async (req, res) => {
  try {
    const { facultyId } = req.params;

    if (!facultyId) {
      return res.status(400).json({ msg: "Faculty ID is required" });
    }

    // Get today's day (e.g., "Monday")
    const today = new Date().toLocaleDateString("en-US", { weekday: "long" });

    // Fetch timetable entries where facultyId matches
    const timetable = await Timetable.find({ "faculty.employeeId": facultyId });

    // Filter schedules for today only
    const todayTimetable = timetable
      .map(entry => ({
        ...entry.toObject(),
        schedule: entry.schedule.filter(scheduleItem => scheduleItem.day === today)
      }))
      .filter(entry => entry.schedule.length > 0); // Remove empty schedules

    if (!todayTimetable.length) {
      return res.status(404).json({ msg: `No timetable found for today (${today})` });
    }

    res.json(todayTimetable);
  } catch (err) {
    console.error("Error fetching timetable:", err);
    res.status(500).json({ msg: "Internal Server Error" });
  }
});


app.get("/timetable/full/:facultyId", async (req, res) => {
  try {
    const { facultyId } = req.params;

    if (!facultyId) {
      return res.status(400).json({ msg: "Faculty ID is required" });
    }

    // Fetch timetable for the faculty
    const timetable = await Timetable.find({ "faculty.employeeId": facultyId });

    if (!timetable.length) {
      return res.status(404).json({ msg: "No timetable found for this faculty" });
    }

    // Fetch batch names based on batchId
    const batchIds = timetable.map(entry => entry.batchId);
    const batches = await Batch.find({ batchId: { $in: batchIds } }).select("batchId batchName");

    // Map batchId to batchName
    const batchMap = {};
    batches.forEach(batch => {
      batchMap[batch.batchId] = batch.batchName;
    });

    // Attach batch names to the timetable response
    const updatedTimetable = timetable.map(entry => ({
      ...entry.toObject(),
      batchName: batchMap[entry.batchId] || "Unknown Batch"
    }));

    res.json(updatedTimetable);
  } catch (err) {
    console.error("Error fetching full timetable:", err);
    res.status(500).json({ msg: "Internal Server Error" });
  }
});

app.post("/api/leave", async (req, res) => {
  try {
    const newLeave = new Leave(req.body);
    await newLeave.save();
    res.status(201).json({ message: "Leave request submitted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to submit leave request" });
  }
});
app.get("/api/leave", async (req, res) => {
  try {
    const { employeeId } = req.query;
    const leaveRequests = await Leave.find({ employeeId }); // Fetch only for the logged-in user
    res.status(200).json(leaveRequests);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch leave requests" });
  }
});
app.put("/api/leave/:id", async (req, res) => {
  try {
    const { status } = req.body;
    await Leave.findByIdAndUpdate(req.params.id, { status });
    res.json({ message: "Leave status updated successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to update leave status" });
  }
});
// app.get("/api/leave/all", async (req, res) => {
//   try {
//     const leaves = await Leave.find();
//     res.json(leaves);
//   } catch (error) {
//     res.status(500).json({ error: "Failed to fetch leave requests" });
//   }
// });

// const generateInvoiceNo = async () => {
//   const lastInvoice = await Invoice.findOne().sort({ _id: -1 }); // Get the last invoice
//   let newInvoiceNo = "CAD01"; // Default if no previous invoices

//   if (lastInvoice && lastInvoice.invoiceNo) {
//     const lastNumber = parseInt(lastInvoice.invoiceNo.replace("CAD", ""), 10);
//     newInvoiceNo = `CAD${String(lastNumber + 1).padStart(2, '0')}`; // Increment and format
//   }

//   return newInvoiceNo;
// };

// Fetch all invoices

app.get("/api/leave/all", async (req, res) => {
  try {
    const { branchId } = req.query;

    let leaves;
    if (branchId) {
      leaves = await Leave.find({ branchId });
    } else {
      leaves = await Leave.find(); // Return all if SuperAdmin
    }

    res.json(leaves);
  } catch (error) {
    console.error("Error fetching leave requests:", error);
    res.status(500).json({ error: "Failed to fetch leave requests" });
  }
});
app.get('/invoices', async (req, res) => {
  const invoices = await Invoice.find();
  res.json(invoices);
});

// // Add a new invoice with auto-generated invoiceNo
// app.post('/invoices', async (req, res) => {
//   try {
//     const invoiceNo = await generateInvoiceNo(); // Generate new invoice number
//     const newInvoice = new Invoice({ ...req.body, invoiceNo }); // Assign it
//     await newInvoice.save();
//     res.json({ message: 'Invoice added', invoiceNo });
//   } catch (error) {
//     res.status(500).json({ message: 'Error adding invoice', error });
//   }
// });
// app.get('/generate-invoice-no', async (req, res) => {
//   try {
//     const lastInvoice = await Invoice.findOne().sort({ _id: -1 }); // Get last invoice
//     let newNumber = "CAD01"; // Default for first invoice

//     if (lastInvoice) {
//       const lastNo = lastInvoice.invoiceNo.match(/\d+/g); // Extract the number part
//       const nextNo = parseInt(lastNo) + 1; // Increment number
//       newNumber = `CAD${String(nextNo).padStart(2, '0')}`; // Format like CAD01, CAD02...
//     }

//     res.json({ invoiceNo: newNumber }); // Send the new invoice number
//   } catch (error) {
//     console.error("Error generating invoice number:", error);
//     res.status(500).json({ error: "Server error" });
//   }
// });



app.post("/invoices", async (req, res) => {
  try {
    const { branch } = req.body;

    if (!branch) {
      return res.status(400).json({ error: "branchid is required" });
    }

    // Atomically increment the counter for the branch
    const counter = await InvoiceCounter.findOneAndUpdate(
      { branch },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const invoiceNo = `${branch}-${String(counter.seq).padStart(2, '0')}`;

    // Create new invoice with generated invoice number
    const newInvoice = new Invoice({
      ...req.body,
      invoiceNo, // override frontend input
    });

    await newInvoice.save();
    res.status(201).json({ message: "Invoice created", invoice: newInvoice });
  } catch (error) {
    console.error("Error creating invoice:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// app.delete('/:invoiceId', async (req, res) => {
//   const { invoiceId } = req.params;

//   try {
//     const deletedInvoice = await Invoice.findByIdAndDelete(invoiceId);
//     if (!deletedInvoice) {
//       return res.status(404).json({ message: 'Invoice not found' });
//     }

//     res.status(200).json({ message: 'Invoice deleted successfully' });
//   } catch (error) {
//     console.error('Error deleting invoice:', error);
//     res.status(500).json({ message: 'Server error while deleting invoice' });
//   }
// });

// app.get('/generate-invoice-no', async (req, res) => {
//     try {
//         const lastInvoice = await Invoice.findOne().sort({ _id: -1 }); // Get last invoice
//         let newNumber = "CAD01"; // Default for first invoice

//         if (lastInvoice) {
//             const lastNo = lastInvoice.invoiceNo.match(/\d+/g); // Extract the number part
//             const nextNo = parseInt(lastNo) + 1; // Increment number
//             newNumber = `CAD${String(nextNo).padStart(2, '0')}`; // Format like CAD01, CAD02...
//         }

//         res.json({ invoiceNo: newNumber }); // Send the new invoice number
//     } catch (error) {
//         console.error("Error generating invoice number:", error);
//         res.status(500).json({ error: "Server error" });
//     }
// });

// GET /generate-invoice-no?branchId=BR001
app.get('/generate-invoice-no', async (req, res) => {
  const { branchId } = req.query;

  if (!branchId) {
      return res.status(400).json({ error: "branchId is required" });
  }

  try {
      // Get the last invoice for this branch
      const lastInvoice = await Invoice.findOne({ branchid: branchId })
          .sort({ _id: -1 });

      let newNumber = `${branchId}-01`; // Default for first invoice

      if (lastInvoice && lastInvoice.invoiceNo) {
          const lastNo = lastInvoice.invoiceNo.split("-")[1]; // Extract number part
          const nextNo = parseInt(lastNo) + 1;
          newNumber = `${branchId}-${String(nextNo).padStart(2, '0')}`;
      }

      res.json({ invoiceNo: newNumber });
  } catch (error) {
      console.error("Error generating invoice number:", error);
      res.status(500).json({ error: "Server error" });
  }
});

// DELETE endpoint to remove an invoice by ID
app.delete("/invoices/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if the ID is valid
    if (!id) {
      return res.status(400).json({ error: "Invoice ID is required" });
    }
    
    // Find the invoice and delete it
    const deletedInvoice = await Invoice.findByIdAndDelete(id);
    
    // If no invoice was found with that ID
    if (!deletedInvoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    
    // Return success response
    res.status(200).json({ 
      message: "Invoice deleted successfully", 
      deletedInvoice 
    });
    
  } catch (error) {
    console.error("Error deleting invoice:", error);
    
    // Handle invalid ID format error
    if (error.name === 'CastError') {
      return res.status(400).json({ error: "Invalid invoice ID format" });
    }
    
    res.status(500).json({ error: "Server error" });
  }
});

app.post('/api/events', async (req, res) => {
  console.log("Event data:", req.body); // Log the incoming event data
  try {
    const {
      MasterBranchID,
      branchId,
      eventName,
      date,
      participants,
      description,
      facultyArray,
      studentArray,
      batchArray
    } = req.body;

    // Validate required fields
    if (!branchId || !eventName || !date || !participants || !description) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    // Create new event
    const newEvent = new Event({
      MasterBranchID,
      branchId,
      eventName,
      date,
      participants,
      description,
      facultyArray: facultyArray || [],
      studentArray: studentArray || [],
      batchArray: batchArray || []
    });

    // Save to database
    const savedEvent = await newEvent.save();

    res.status(201).json({
      message: 'Event created successfully',
      event: savedEvent
    });
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({
      message: 'Server error while creating event',
      error: error.message
    });
  }
});


app.get("/api/events/accessible", async (req, res) => {
  try {
    const { userId, branchId, role, isSuperAdmin, currentDate } = req.query;
    console.log("roleswee", req.query);
    if (!userId || !currentDate || (isSuperAdmin === 'false' && !branchId) || !role) {
      return res.status(400).json({ message: "Missing required parameters" });
    }

    console.log("Request parameters:", req.query);

    // Parse the current date
    const today = new Date(currentDate);

    // Calculate date for "previous days" (starting from today)
    const previousDays = new Date(today);
    previousDays.setDate(today.getDate() - 0);

    // Calculate date for "upcoming days" (2 days after today)
    const upcomingDays = new Date(today);
    upcomingDays.setDate(today.getDate() + 2);

    // Base query for date range
    const baseQuery = {
      date: {
        $gte: previousDays,
        $lte: upcomingDays
      }
    };

    // If user is a SuperAdmin, fetch events from all branches regardless of participants
    if (isSuperAdmin === 'true') {
      console.log("Fetching events for SuperAdmin (all branches, all participants)");
      // No need to filter by participants for SuperAdmin
    } else {
      console.log(`Fetching events for branch: ${branchId} and role: ${role}`);

      // Handle filtering based on the schema structure
      if (role === "Student") {
        // For students, we need to:
        // 1. Find events with "Student" in participants for that branch
        // 2. Find events where the student is directly in studentArray (for backward compatibility)
        // 3. Find events where any batch in batchArray contains this student in assignedStudents

        // First, find all batches where this student is assigned
        const studentBatches = await Batch.find({
          assignedStudents: userId
        }).select('_id');

        const studentBatchIds = studentBatches.map(batch => batch._id);

        console.log(`Found ${studentBatchIds.length} batches for student ${userId}`);

        baseQuery.$or = [
          { branchId: branchId, participants: { $in: ["Student"] } },
          { studentArray: userId }, // Directly check if student is in studentArray (legacy)
          { batchArray: { $in: studentBatchIds } } // Check if any of the student's batches are in the event's batchArray
        ];
      } else if (role === "Faculty") {
        // For faculty, check both participants array and facultyArray
        baseQuery.$or = [
          { branchId: branchId, participants: { $in: ["Faculty"] } },
          { facultyArray: userId } // Directly check if faculty is in facultyArray
        ];
      } else {
        // Fallback to original logic for other roles
        baseQuery.branchId = branchId;
        baseQuery.participants = { $in: [role] };
      }
    }

    // Fetch events and populate faculty, student, and batch arrays for more detailed information
    const events = await Event.find(baseQuery)
      .populate('facultyArray', 'firstName lastName employeeId')
      .populate('studentArray', 'firstName lastName registrationNumber')
      .populate({
        path: 'batchArray',
        select: 'batchName batchId assignedStudents',
        populate: {
          path: 'assignedStudents',
          select: 'firstName lastName registrationNumber'
        }
      })
      .sort({ date: 1 })
      .lean();

    // First get all unique branchIds from events
    const branchIdSet = new Set();
    events.forEach(event => {
      if (event.branchId) {
        // Split by comma and add each branch ID to the set
        const ids = event.branchId.split(',').map(id => id.trim());
        ids.forEach(id => branchIdSet.add(id));
      }
    });
    const branchIds = [...branchIdSet];

    // Then fetch all branches in one query
    const branches = await Branch.find({ branchId: { $in: branchIds } });

    // Create a map for quick lookups
    const branchMap = {};
    branches.forEach(branch => {
      branchMap[branch.branchId] = branch.branchName;
    });

    // Add branch names to events and determine if user is specifically invited
    const eventsWithBranchNames = events.map(event => {
      const eventObj = event.toObject();

      if (eventObj.branchId) {
        if (eventObj.branchId.includes(',')) {
          // Handle comma-separated branch IDs
          const ids = eventObj.branchId.split(',').map(id => id.trim());
          const branchNames = ids.map(id => branchMap[id] || "Unknown");
          eventObj.branchName = branchNames.join(', ');
        } else {
          // Handle single branch ID
          eventObj.branchName = branchMap[eventObj.branchId] || "Unknown Branch";
        }
      } else {
        eventObj.branchName = "N/A";
      }

      // Add a flag to indicate if the current user is specifically included
      if (role === "Student") {
        // Check if student is directly in studentArray
        const isInStudentArray = eventObj.studentArray.some(student =>
          student._id.toString() === userId
        );

        // Check if student is in assignedStudents of any batch in batchArray
        let isInBatchArray = false;

        if (eventObj.batchArray && eventObj.batchArray.length > 0) {
          isInBatchArray = eventObj.batchArray.some(batch => {
            return batch.assignedStudents && batch.assignedStudents.some(student =>
              student._id.toString() === userId
            );
          });
        }

        eventObj.isSpecificallyInvited = isInStudentArray || isInBatchArray;
      } else if (role === "Faculty") {
        eventObj.isSpecificallyInvited = eventObj.facultyArray.some(faculty =>
          faculty._id.toString() === userId
        );
      }

      return eventObj;
    });

    console.log("Events with branch names:", eventsWithBranchNames.map(event => ({
      eventName: event.eventName || "No eventName field",
      branchId: event.branchId,
      branchName: event.branchName
    })));

    return res.status(200).json({ events: eventsWithBranchNames });
  } catch (error) {
    console.error("Error fetching accessible events:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
});
// Get all events (with faculty and student details)
app.get('/api/events', async (req, res) => {
  try {
    const events = await Event.find()
      .populate('facultyArray', 'firstName lastName employeeId')
      .populate('studentArray', 'firstName lastName registrationNumber')
      .lean();

    res.status(200).json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ message: 'Server error while fetching events', error: error.message });
  }
});

// Get a specific event by ID
app.get('/api/events/:id', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('facultyArray', 'firstName lastName employeeId')
      .populate('studentArray', 'firstName lastName registrationNumber');

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    res.json(event);
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({ message: 'Server error while fetching event', error: error.message });
  }
});

// Get all events (no populate, simple)
app.get("/api/events/all", async (req, res) => {
  try {
    const events = await Event.find();
    res.status(200).json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ message: "Error fetching events", error: error.message });
  }
});

app.put("/api/events/:id", async (req, res) => {
  console.log("Update Event data:", req.body); // Log the incoming event data
  try {
    const {
      MasterBranchID,
      branchId,
      eventName,
      date,
      participants,
      description,
      facultyArray,
      studentArray,
      batchArray,
    } = req.body;

    // Convert branchId array to comma-separated string if it's an array
    const cleanBranchId = Array.isArray(branchId) ? branchId.join(",") : branchId;

    const updatedEvent = await Event.findByIdAndUpdate(
      req.params.id,
      {
        MasterBranchID,
        branchId: cleanBranchId,
        eventName,
        date,
        participants,
        description,
        facultyArray,
        studentArray,
        batchArray,
      },
      { new: true, runValidators: true }
    );

    if (!updatedEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.json({ message: "Event updated successfully", event: updatedEvent });
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).json({ message: "Error updating event", error });
  }
});


app.delete("/api/events/:id", async (req, res) => {
  try {
    await Event.findByIdAndDelete(req.params.id);
    res.json({ message: "Event deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting event", error });
  }
});

app.get('/getFacultiesBySubjectAndBranch/:subjectCode/:branchId', async (req, res) => {
  const { subjectCode, branchId } = req.params;

  try {
    // Log incoming request parameters
    console.log('Received Request Parameters:', { subjectCode, branchId });

    // Validate input
    if (!subjectCode || !branchId) {
      return res.status(400).json({
        message: 'Subject Code and Branch ID are required'
      });
    }

    // Detailed query with multiple checks
    const faculties = await Faculty.find({
      $and: [
        { 'branchId': branchId },  // Match branch
        { 'subjects': { $elemMatch: { subjectCode: subjectCode } } } // Match subject
      ]
    })
      .populate('branchId', 'branchName')  // Optional: populate branch details
      .populate('subjects', 'subjectName'); // Optional: populate subject details

    // Log found faculties
    console.log('Found Faculties:', faculties.length);

    // Check if any faculties found
    if (faculties.length === 0) {
      return res.status(404).json({
        message: 'No faculties found for this subject and branch',
        details: {
          subjectCode,
          branchId
        }
      });
    }

    // Transform faculty data if needed
    const facultyResponse = faculties.map(faculty => ({
      employeeId: faculty.employeeId,
      firstName: faculty.firstName,
      lastName: faculty.lastName,
      email: faculty.email,
      branch: faculty.branch?.branchName,
      subjects: faculty.subjects.map(s => s.subjectName)
    }));

    res.status(200).json(facultyResponse);

  } catch (error) {
    // Comprehensive error logging
    console.error('Faculty Retrieval Error:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    // Differentiate between different types of errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: 'Validation Error',
        errors: error.errors
      });
    }

    // Database connection or query error
    res.status(500).json({
      message: 'Internal Server Error',
      error: 'Unable to retrieve faculties'
    });
  }
});

app.post('/api/record-payment/:id', upload1.single('receiptDocument'), async (req, res) => {
  try {
    const { id } = req.params;
    const { installmentIndex, paidAmount, paidDate, receivedBy, transactionId } = req.body;

    // Find the registration
    const registration = await Registration.findById(id);
    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }

    // Ensure paymentsPlan array exists
    if (!registration.paymentsPlan) {
      registration.paymentsPlan = [];
    }

    // Get the payment plan for the specified index
    if (!registration.paymentsPlan[installmentIndex]) {
      return res.status(400).json({ message: 'Payment plan not found for this installment' });
    }

    // Update payment details
    registration.paymentsPlan[installmentIndex].status = 'Paid';
    registration.paymentsPlan[installmentIndex].paidDate = paidDate;
    registration.paymentsPlan[installmentIndex].paidAmount = paidAmount;
    registration.paymentsPlan[installmentIndex].receivedBy = receivedBy;
    registration.paymentsPlan[installmentIndex].transactionId = transactionId;

    // If receipt file was uploaded
    if (req.file) {
      registration.paymentsPlan[installmentIndex].receiptPath = req.file.path;
    }

    // Save the updated registration
    await registration.save();

    res.status(200).json(registration);
  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
app.get("/api/registration/:id", async (req, res) => {
  try {
    const registration = await Registration.findById(req.params.id);
    if (!registration) {
      return res.status(404).json({ message: "Registration not found" });
    }
    res.json(registration);
  } catch (error) {
    res.status(500).json({ message: "Error fetching registration", error });
  }
});
app.get("/api/registrations/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const registrations = await Registration.find({ _id: userId }); // Assuming `_id` is the user ID
    res.json(registrations);
  } catch (error) {
    res.status(500).json({ message: "Error fetching registrations", error });
  }
});

app.put("/api/update-installment/:registrationId/:installmentId", async (req, res) => {
  try {
    const { registrationId, installmentId } = req.params;

    const updatedRegistration = await Registration.findOneAndUpdate(
      { _id: registrationId, "paymentsPlan._id": installmentId },
      {
        $set: {
          "paymentsPlan.$.status": "Paid",
          "paymentsPlan.$.paidDate": new Date().toISOString(),
          "paymentsPlan.$.transactionId": req.body.transactionId || "TXN" + Date.now(),
          "paymentsPlan.$.paidAmount": req.body.amount,
        },
      },
      { new: true }
    );

    if (!updatedRegistration) {
      return res.status(404).json({ error: "Registration or Installment not found" });
    }

    res.json({ message: "Installment updated to Paid", updatedRegistration });
  } catch (error) {
    console.error("Error updating installment:", error);
    res.status(500).json({ error: "Server error" });
  }
});
app.get('/api/attendance/batch/:batchId', async (req, res) => {
  try {
    const { batchId } = req.params;
    console.log("newbatch::", req.params);

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(batchId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid batch ID format' 
      });
    }

    // First, get the batch and its assigned students
    const batch = await Batch.findById(batchId).populate({
      path: 'assignedStudents',
      select: '_id regid fName lName email phone'
    });

    if (!batch) {
      return res.status(404).json({ 
        success: false, 
        message: 'Batch not found' 
      });
    }

    if (!batch.assignedStudents || batch.assignedStudents.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'No students assigned to this batch' 
      });
    }

    const assignedStudents = batch.assignedStudents;
    console.log("Assigned students:", assignedStudents.length);
    console.log("First assigned student:", assignedStudents[0]);

    // Get all attendance records for this batch
    const attendanceRecords = await StudentAttendance.find({ 
      batchId: batchId 
    }).populate({
      path: 'students.studentId',
      select: 'regid fName lName email phone'
    });

    console.log("Attendance records found:", attendanceRecords.length);
    if (attendanceRecords.length > 0) {
      console.log("First attendance record:", {
        date: attendanceRecords[0].date,
        studentsCount: attendanceRecords[0].students.length,
        firstStudent: attendanceRecords[0].students[0]
      });
    }

    // Create a map to store each student's attendance summary
    const studentAttendanceMap = new Map();

    // Initialize all assigned students
    assignedStudents.forEach(student => {
      const fullName = `${student.fName || ''} ${student.lName || ''}`.trim();
      studentAttendanceMap.set(student._id.toString(), {
        studentId: student._id,
        studentName: fullName,
        studentRegId: student.regid,
        email: student.email,
        phone: student.phone,
        totalDays: 0,
        presentDays: 0,
        absentDays: 0,
        halfDays: 0,
        attendancePercentage: 0,
        recentAttendance: []
      });
    });

    console.log("Initialized student map with", studentAttendanceMap.size, "students");

    // Process attendance records
    attendanceRecords.forEach((record, recordIndex) => {
      console.log(`Processing record ${recordIndex + 1} for date:`, record.date);
      console.log("Students in this record:", record.students.length);
      
      record.students.forEach((studentAttendance, studentIndex) => {
        // Check if studentId is populated
        if (!studentAttendance.studentId) {
          console.log(`StudentId not populated for attendance record ${recordIndex + 1}, student ${studentIndex + 1}`);
          return;
        }

        const studentIdStr = studentAttendance.studentId._id.toString();
        console.log(`Processing student ${studentIndex + 1}:`, {
          id: studentIdStr,
          name: studentAttendance.studentId.fName + ' ' + studentAttendance.studentId.lName,
          status: studentAttendance.status
        });
        
        if (studentAttendanceMap.has(studentIdStr)) {
          const studentData = studentAttendanceMap.get(studentIdStr);
          
          // Update totals
          studentData.totalDays++;
          
          // Count by status
          switch (studentAttendance.status) {
            case 'full-day':
              studentData.presentDays++;
              break;
            case 'half-day':
              studentData.halfDays++;
              break;
            case 'absent':
              studentData.absentDays++;
              break;
            default:
              console.log('Unknown attendance status:', studentAttendance.status);
              break;
          }

          // Add to recent attendance (keep last 5 records)
          studentData.recentAttendance.push({
            date: record.date,
            status: studentAttendance.status
          });

          // Keep only recent 5 records and sort by date descending
          studentData.recentAttendance.sort((a, b) => new Date(b.date) - new Date(a.date));
          if (studentData.recentAttendance.length > 5) {
            studentData.recentAttendance = studentData.recentAttendance.slice(0, 5);
          }

          studentAttendanceMap.set(studentIdStr, studentData);
          console.log(`Updated student data:`, {
            name: studentData.studentName,
            totalDays: studentData.totalDays,
            presentDays: studentData.presentDays,
            halfDays: studentData.halfDays,
            absentDays: studentData.absentDays
          });
        } else {
          console.log("Student not found in assigned students map:", {
            studentId: studentIdStr,
            studentName: studentAttendance.studentId.fName + ' ' + studentAttendance.studentId.lName
          });
        }
      });
    });

    // Calculate attendance percentage for each student
    const attendanceData = Array.from(studentAttendanceMap.values()).map(student => {
      if (student.totalDays > 0) {
        // Calculate percentage: (present days + half days * 0.5) / total days * 100
        const effectivePresentDays = student.presentDays + (student.halfDays * 0.5);
        student.attendancePercentage = Math.round((effectivePresentDays / student.totalDays) * 100);
      }
      return student;
    });

    // Sort by attendance percentage descending
    attendanceData.sort((a, b) => b.attendancePercentage - a.attendancePercentage);

    console.log("Final attendance data:", attendanceData.length);
    console.log("Sample student data:", attendanceData[0]);

    // Calculate summary
    const totalStudents = attendanceData.length;
    const averageAttendance = totalStudents > 0 ? Math.round(
      attendanceData.reduce((sum, student) => sum + student.attendancePercentage, 0) / totalStudents
    ) : 0;

    res.status(200).json({
      success: true,
      data: attendanceData,
      summary: {
        totalStudents: totalStudents,
        averageAttendance: averageAttendance,
        batchName: batch.batchName,
        totalAttendanceRecords: attendanceRecords.length
      }
    });

  } catch (error) {
    console.error('Error fetching batch attendance:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});
app.post("/api/attendance", async (req, res) => {
  try {
    const { facultyId, facultyName, department, date, month, year, inTime, outTime } = req.body;

    if (!facultyId || !facultyName || !department || !date || !month || !year) {
      return res.status(400).json({ msg: "All fields are required except inTime and outTime" });
    }

    let attendanceRecord = await AttendanceModel.findOne({ date, month, year });

    if (!attendanceRecord) {
      attendanceRecord = new AttendanceModel({
        date,
        month,
        year,
        facultyAttendance: [{ facultyId, facultyName, department, inTime, outTime }],
      });
    } else {
      const facultyIndex = attendanceRecord.facultyAttendance.findIndex(fac => fac.facultyId.toString() === facultyId);
      if (facultyIndex !== -1) {
        if (inTime) attendanceRecord.facultyAttendance[facultyIndex].inTime = inTime;
        if (outTime) attendanceRecord.facultyAttendance[facultyIndex].outTime = outTime;
      } else {
        attendanceRecord.facultyAttendance.push({ facultyId, facultyName, department, inTime, outTime });
      }
    }

    await attendanceRecord.save();
    res.status(201).json({ msg: "Attendance updated successfully", attendanceRecord });
  } catch (error) {
    res.status(500).json({ msg: "Error saving attendance", error: error.message });
  }
});

// Fetch attendance by month and year4
app.get("/api/attendance/:month/:year", async (req, res) => {
  try {
    const { month, year } = req.params;
    // month=0 means "all months" — query only by year
    const query = month === "0" ? { year } : { month, year };
    const attendanceRecords = await AttendanceModel.find(query).lean();
    res.status(200).json(attendanceRecords);
  } catch (error) {
    res.status(500).json({ msg: "Error fetching attendance", error: error.message });
  }
});

// Fetch distinct months that have attendance data for a given year
app.get("/api/attendance-months/:year", async (req, res) => {
  try {
    const { year } = req.params;
    const months = await AttendanceModel.distinct("month", { year });
    res.json(months.map(m => ({ month: m })));
  } catch (error) {
    res.status(500).json({ msg: "Error fetching attendance months", error: error.message });
  }
});

// Fetch attendance summary for a specific month and year4
app.get("/api/attendance-summary/:month/:year", async (req, res) => {
  try {
    const { month, year } = req.params;
    const attendanceRecords = await AttendanceModel.find({ month, year });

    const summary = {};

    attendanceRecords.forEach((record) => {
      record.facultyAttendance.forEach((attendance) => {
        const { facultyId, facultyName, department, inTime, outTime } = attendance;

        if (!summary[facultyId]) {
          summary[facultyId] = {
            facultyId,
            facultyName,
            department,
            fullDays: 0,
            halfDays: 0,
            absents: 0,
            totalDays: new Date(year, month, 0).getDate(), // Days in the month
          };
        }

        if (inTime && outTime) {
          summary[facultyId].fullDays += 1; // Full day present
        } else if (inTime || outTime) {
          summary[facultyId].halfDays += 1; // Half day present
        } else {
          summary[facultyId].absents += 1; // Absent
        }
      });
    });

    res.json(Object.values(summary));
  } catch (error) {
    res.status(500).json({ msg: "Error fetching attendance summary", error: error.message });
  }
});


app.get("/api/attendance-summary", async (req, res) => {
  try {
    const { month, year, department } = req.query;

    const query = { month: parseInt(month), year: parseInt(year) };
    if (department && department !== "All") query.department = department;

    const attendanceRecords = await AttendanceModel.find(query);

    const summary = attendanceRecords.reduce((acc, record) => {
      const key = record.facultyId;

      if (!acc[key]) {
        acc[key] = {
          facultyName: record.facultyName,
          department: record.department,
          fullDay: 0,
          halfDay: 0,
          absent: 0,
        };
      }

      if (record.status === "full-day") acc[key].fullDay++;
      if (record.status === "half-day") acc[key].halfDay++;
      if (record.status === "absent") acc[key].absent++;

      return acc;
    }, {});

    res.json(Object.values(summary));
  } catch (error) {
    res.status(500).json({ msg: "Error fetching summary", error: error.message });
  }
});


app.get("/api/attendance/summary/:facultyId/:month", async (req, res) => {
  try {
    const { facultyId, month } = req.params;

    if (!facultyId || facultyId === "undefined") {
      return res.status(400).json({ msg: "Invalid faculty ID" });
    }

    const records = await Attendance.find({ facultyId, month: parseInt(month) });

    if (records.length === 0) {
      return res.status(404).json({ msg: "No attendance data found" });
    }

    const summary = {
      totalDays: records.length,
      fullDays: records.filter((r) => r.status === "full-day").length,
      halfDays: records.filter((r) => r.status === "half-day").length,
      absents: records.filter((r) => r.status === "absent").length,
      attendancePercentage: ((records.filter((r) => r.status !== "absent").length / records.length) * 100).toFixed(2),
    };

    res.json(summary);
  } catch (error) {
    res.status(500).json({ msg: "Error fetching summary", error: error.message });
  }
});

app.get("/api/faculty-batches/:facultyId", async (req, res) => {
  const { facultyId } = req.params;

  try {
    const batches = await Batch.find({
      "subject.faculty": facultyId,
    });

    const response = [];

    for (const batch of batches) {
      for (const sub of batch.subject) {
        if (sub.faculty.toString() === facultyId) {
          // ✅ Case-insensitive subjectCode matching
          const subjectDoc = await Subject.findOne({
            subjectCode: { $regex: new RegExp(`^${sub.subject}$`, "i") },
          });

          response.push({
            batchId: batch.batchId,
            batchName: batch.batchName,
            subjectCode: sub.subject,
            subjectName: subjectDoc ? subjectDoc.subjectName : sub.subject,
          });
        }
      }
    }

    console.log("Filtered data with subject names:", response);
    res.json(response);
  } catch (err) {
    console.error("Error fetching faculty batches:", err);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});

app.get('/api/faculty', async (req, res) => {
  try {
    let { branchIds } = req.query;

    // Handle both string format (comma-separated) and array format
    if (!Array.isArray(branchIds)) {
      branchIds = branchIds.split(',').filter(id => id.trim());
    }

    // Validate branchIds
    if (!branchIds || !branchIds.length) {
      return res.status(400).json({ message: 'Branch IDs are required' });
    }

    // Query faculty with the specified branch IDs
    const faculty = await mongoose.model('Faculty').find({
      branchId: { $in: branchIds }
    }).select('firstName lastName email phone employeeId department role branchId');

    // Return the results
    res.json(faculty);
  } catch (error) {
    console.error('Error fetching faculty:', error);
    res.status(500).json({ message: 'Server error while fetching faculty', error: error.message });
  }
});


// API to get batches by branch and employee
app.get('/api/batches/announcement', async (req, res) => {
  try {
    const { branchId, employeeId } = req.query;
    console.log("ann", req.body)
    // Find timetables matching branch and employee
    const timetables = await Timetable.find({
      branchId: branchId,
      'faculty.employeeId': employeeId
    });

    // Extract batchIds from timetables
    const batchIds = timetables.map(tt => tt.batchId);

    // Find batches corresponding to those batchIds
    const batches = await Batch.find({
      branchId: branchId,
      batchId: { $in: batchIds }
    });

    res.json(batches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


// 2. Update the POST endpoint for announcements


app.get('/api/student/announcements', async (req, res) => {
  try {
    const { userId, branchId } = req.query;
    console.log("userresponse", req.query);

    // Check if userId is provided
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    // Safely convert userId string to MongoDB ObjectId
    let userObjectId;
    try {
      userObjectId = new mongoose.Types.ObjectId(userId);
    } catch (err) {
      return res.status(400).json({ message: 'Invalid userId format' });
    }

    // Find batches where the student is assigned
    const matchingBatches = await Batch.find({
      branchId: branchId,
      assignedStudents: userObjectId
    });

    // Extract batchIds from matching batches
    const batchIds = matchingBatches.map(batch => batch.batchId);
    console.log("batches found:", matchingBatches.length);
    console.log("batch ids:", batchIds);

    // Fetch announcements for these batches with the new schema structure
    // Use $elemMatch to find documents where at least one batch in the array matches student's batch
    const announcements = await Announcement.find({
      branchId: branchId,
      'batches.batchId': { $in: batchIds }
    });
    console.log("announcements found:", announcements);
    res.json(announcements);
  } catch (error) {
    console.error('Error fetching student announcements:', error);
    res.status(500).json({
      message: 'Error fetching announcements',
      error: error.message
    });
  }
});
app.get('/api/batches/announcement', async (req, res) => {
  try {
    const { branchId, employeeId } = req.query;

    // Find timetables matching branch and employee
    const timetables = await Timetable.find({
      branchId: branchId,
      'faculty.employeeId': employeeId
    });

    // Extract batchIds from timetables
    const batchIds = timetables.map(tt => tt.batchId);

    // Find batches corresponding to those batchIds
    const batches = await Batch.find({
      branchId: branchId,
      batchId: { $in: batchIds }
    });

    res.json(batches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/students/paid-status', async (req, res) => {
  try {
    // Extract query parameters
    const {
      page = 1,
      limit = 10,
      branchId = "",
      batchId = "",
      search = ""
    } = req.query;

    // First, get all batches with awarded date (if any)
    const batchQuery = {};

    if (branchId) {
      batchQuery.branchId = branchId;
    }

    if (batchId) {
      batchQuery.batchId = batchId;
    }

    // Fetch only batches that have an awarded date
    batchQuery.awardedDate = { $exists: true, $ne: null };
    batchQuery.status = 'complete';
    // Get batches with students assigned
    const batches = await Batch.find(batchQuery)

    // Extract all student IDs from the awarded batches
    const studentIds = [];
    batches.forEach(batch => {
      if (batch.assignedStudents && batch.assignedStudents.length > 0) {
        studentIds.push(...batch.assignedStudents);
      }
    });

    // Create a map of student IDs to an array of batch details
    const studentBatchMap = {};
    batches.forEach(batch => {
      batch.assignedStudents.forEach(studentId => {
        const sid = studentId.toString();
        if (!studentBatchMap[sid]) {
          studentBatchMap[sid] = [];
        }
        studentBatchMap[sid].push({
          batchId: batch.batchId,
          batchName: batch.batchName,
          day: batch.day,
          status: batch.status,
          timeSlot: batch.timeSlot,
          awardedDate: batch.awardedDate
        });
      });
    });

    // Build search query if provided
    const searchMatch = search ? {
      $or: [
        { regid: { $regex: search, $options: 'i' } },
        { fName: { $regex: search, $options: 'i' } },
        { lName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { courseName: { $regex: search, $options: 'i' } }
      ]
    } : {};

    // Get all students from the awarded batches
    const students = await Registration.find({
      _id: { $in: studentIds },
      ...searchMatch
    }).lean();

    // Process students to include payment status and batch details
    const processedStudents = students.map(student => {
      const processedStudent = {
        ...student,
        fullName: `${student.fName} ${student.lName}`
      };

      // Add batch details (array of batches)
      if (studentBatchMap[student._id.toString()]) {
        processedStudent.batchDetails = studentBatchMap[student._id.toString()];
        console.log(`Batch details for student ${student._id}:`, processedStudent.batchDetails);
      }

      // Add payment status info
      if (student.feeType === 'Single') {
        processedStudent.paymentComplete = student.singlePaymentStatus === 'Paid';
        processedStudent.paymentDetails = {
          status: student.singlePaymentStatus,
          transactionId: student.singlePaymentTransactionId || 'N/A'
        };
      } else if (student.feeType === 'Installment') {
        const lastPaymentIndex = student.installmentCount - 1;
        if (student.paymentsPlan && student.paymentsPlan[lastPaymentIndex]) {
          const lastPayment = student.paymentsPlan[lastPaymentIndex];
          processedStudent.paymentComplete = lastPayment.status === 'Paid';
          processedStudent.paymentDetails = {
            status: lastPayment.status,
            transactionId: lastPayment.transactionId || 'N/A'
          };
        } else {
          processedStudent.paymentComplete = false;
          processedStudent.paymentDetails = {
            status: 'Incomplete',
            transactionId: 'N/A'
          };
        }
      }

      return processedStudent;
    });

    // Apply pagination
    const total = processedStudents.length;
    const paginatedStudents = processedStudents.slice(
      (parseInt(page) - 1) * parseInt(limit),
      parseInt(page) * parseInt(limit)
    );

    // Get all unique branch IDs that have awarded batches
    const branches = [...new Set(batches.map(batch => batch.branchId))];

    // Get all unique batch IDs for the selected branch
    const batchesForDropdown = batches
      .filter(batch => !branchId || batch.branchId === branchId)
      .map(batch => ({
        batchId: batch.batchId,
        batchName: batch.batchName,
        awardedDate: batch.awardedDate
      }));

    res.status(200).json({
      success: true,
      count: paginatedStudents.length,
      total: total,
      totalPages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      branches: branches,
      batches: batchesForDropdown,
      data: paginatedStudents
    });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
});


app.get('/api/certi/batches', async (req, res) => {
  try {
    const { branchId = "" } = req.query;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required'
      });
    }

    // Find batches for the selected branch that have an awarded date
    const batches = await Batch.find({
      branchId,
      awardedDate: { $exists: true, $ne: null },
      assignedStudents: { $exists: true, $ne: [] }
    }).select('batchId batchName day timeSlot awardedDate').lean();

    res.status(200).json({
      success: true,
      count: batches.length,
      data: batches
    });
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
});

// app.get('/api/certificate/download/:regid', async (req, res) => {
//   try {
//     const { regid } = req.params;

//     // Find the student
//     const student = await Registration.findOne({ regid }).lean();
//     if (!student) {
//       return res.status(404).json({ success: false, message: 'Student not found' });
//     }

//     // Find batch
//     const batch = await Batch.find({ assignedStudents: student._id }).lean();
//     console.log("batchsreee:", batch);
//     if (!batch) {
//       return res.status(400).json({ success: false, message: 'Student is not assigned to any batch' });
//     }

//     // Get the course information
//     const course = await Course.findOne({ courseName: student.courseName }).lean();
//     if (!course) {
//       console.log(`Course not found with name: ${student.courseName}, using default course information`);
//     }

//     // Get the branch information - using branchId instead of branchCode
//     const branch = await Branch.findOne({ branchId: student.branchId }).lean();
//     console.log("branch", branch);
//     if (!branch) {
//       // If branch not found with branchCode, try other fields or fallback
//       console.log(`Branch not found with code: ${student.branchId}, using default branch information`);
//       // Create a default branch object if the actual branch can't be found
//       const defaultBranch = {
//         branchName: student.branchName || 'JBK Academy',
//         location: 'Ameerpet'
//       };
//       var branchInfo = defaultBranch;
//     } else {
//       var branchInfo = branch;
//     }

//     // Check payment status
//     let paymentCompleted = student.feeType === 'Single' && student.singlePaymentStatus === 'Paid' ||
//       student.feeType === 'Installment' && student.paymentsPlan?.[student.installmentCount - 1]?.status === 'Paid';
//     if (!paymentCompleted) {
//       return res.status(400).json({ success: false, message: 'Payment not completed' });
//     }

//     // let courseDuration = 'N/A';

//     // // Check if course has the new duration format
//     // if (course?.duration && typeof course.duration === 'object') {
//     //   const { months = 0, days = 0 } = course.duration;

//     //   // Create a readable duration string
//     //   const monthsText = months > 0 ? `${months} month${months > 1 ? 's' : ''}` : '';
//     //   const daysText = days > 0 ? `${days} day${days > 1 ? 's' : ''}` : '';

//     //   if (monthsText && daysText) {
//     //     courseDuration = `${monthsText} and ${daysText}`;
//     //   } else {
//     //     courseDuration = monthsText || daysText || 'N/A';
//     //   }
//     // } 
//     // // Check if batch has the new duration format
//     // else if (batch?.duration && typeof batch.duration === 'object') {
//     //   const { months = 0, days = 0 } = batch.duration;

//     //   // Create a readable duration string
//     //   const monthsText = months > 0 ? `${months} month${months > 1 ? 's' : ''}` : '';
//     //   const daysText = days > 0 ? `${days} day${days > 1 ? 's' : ''}` : '';

//     //   if (monthsText && daysText) {
//     //     courseDuration = `${monthsText} and ${daysText}`;
//     //   } else {
//     //     courseDuration = monthsText || daysText || 'N/A';
//     //   }
//     // }
//     // // Fall back to string duration if available
//     // else {
//     //   courseDuration = course?.duration || batch?.duration || 'N/A';
//     // }

//     // Determine which certificate template to use based on branch name
//     const latestAwarded = batch.reduce((latest, current) =>
//       new Date(current.awardedDate) > new Date(latest.awardedDate) ? current : latest
//     );

//     let courseDuration = 'N/A';

//     if (latestAwarded?.duration && typeof latestAwarded.duration === 'object') {
//       const { months = 0, days = 0 } = latestAwarded.duration;

//       const monthsText = months > 0 ? `${months} month${months > 1 ? 's' : ''}` : '';
//       const daysText = days > 0 ? `${days} day${days > 1 ? 's' : ''}` : '';

//       if (monthsText && daysText) {
//         courseDuration = `${monthsText} and ${daysText}`;
//       } else {
//         courseDuration = monthsText || daysText || 'N/A';
//       }
//     } else if (typeof latestAwarded?.duration === 'string') {
//       courseDuration = latestAwarded.duration;
//     }
//     console.log('latestAwarded.courseDuration:', latestAwarded.duration
//     );


//     let templateFileName;
//     let templateConfig;
//     const branchName = branchInfo.branchName;

//     // Define template configurations with coordinates for each template
//     const templateConfigs = {
//       'JBK-Academy-Ameerpet.pdf': {
//         name: { x: 290, y: 505, size: 26 },
//         guardianName: { x: 290, y: 440, size: 20 },
//         course: { x: 270, y: 379, size: 20 },
//         subjects: { x: 270, y: 320, size: 18 },
//         courseDuration: { x: 235, y: 250, size: 18 },
//         completionDate: { x: 415, y: 250, size: 18 },
//         location: { x: 200, y: 180, size: 18 },
//         grade: { x: 470, y: 180, size: 18 },
//         certificateId: { x: 473, y: 746, size: 17 }
//       },
//       'Onclick-Digital-Marketing.pdf': {
//         name: { x: 315, y: 320, size: 30 },
//         courseDuration: { x: 230, y: 220, size: 18 },
//         completionDate: { x: 519, y: 220, size: 18 },
//         certificateId: { x: 683, y: 486, size: 17 }
//       },
//       'Raster-FxStudios-Certification.pdf': {
//         name: { x: 330, y: 368, size: 26 },
//         guardianName: { x: 585, y: 374, size: 18 },
//         course: { x: 330, y: 288, size: 20 },
//         subjects: { x: 570, y: 288, size: 18 },
//         courseDuration: { x: 370, y: 230, size: 18 },
//         completionDate: { x: 600, y: 230, size: 18 },
//         location: { x: 340, y: 163, size: 18 },
//         grade: { x: 620, y: 165, size: 18 },
//         certificateId: { x: 499, y: 516, size: 17 }
//       }
//     };

//     if (branchName.includes('JBK') || branchName.includes('Academy')) {
//       templateFileName = 'JBK-Academy-Ameerpet.pdf';
//     } else if (branchName.includes('Onclick') || branchName.includes('Digital Marketing')) {
//       templateFileName = 'Onclick-Digital-Marketing.pdf';
//     } else if (branchName.includes('Raster') || branchName.includes('FX Studios')) {
//       templateFileName = 'Raster-FxStudios-Certification.pdf';
//     } else {
//       // Default template if branch name doesn't match
//       templateFileName = 'JBK-Academy-Ameerpet.pdf';
//     }

//     // Get the configuration for the selected template
//     templateConfig = templateConfigs[templateFileName];

//     // Load the appropriate PDF template
//     const pdfPath = path.join(__dirname, `./certificate/${templateFileName}`);
//     const existingPdfBytes = fs.readFileSync(pdfPath);
//     const pdfDoc = await PDFDocument.load(existingPdfBytes);

//     // Embed fonts
//     // You'll need to have these font files in your project
//     const fontPath = path.join(__dirname, './fonts/Montserrat-Bold.ttf');
//     const fontRegularPath = path.join(__dirname, './fonts/Montserrat-Regular.ttf');

//     // Check if fonts exist and embed them
//     let montserratBold, montserratRegular;
//     try {
//       const boldFontBytes = fs.readFileSync(fontPath);
//       const regularFontBytes = fs.readFileSync(fontRegularPath);

//       montserratBold = await pdfDoc.embedFont(boldFontBytes);
//       montserratRegular = await pdfDoc.embedFont(regularFontBytes);
//     } catch (error) {
//       console.log('Could not load custom fonts, using standard font:', error.message);
//       // Fallback to standard font
//       montserratBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
//       montserratRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
//     }

//     const pages = pdfDoc.getPages();
//     const firstPage = pages[0];

//     // Calculate today's date for "awarded on" field
//     const today = new Date().toLocaleDateString();

//     // Get subject list from course schema
//     let subjectsList = 'N/A';
//     if (course && course.subjects && course.subjects.length > 0) {
//       subjectsList = course.subjects.map(subject => subject.subjectName).join(', ');
//     } else {
//       subjectsList = student.courseSubject || student.courseName;
//     }

//     // Function to convert a string to camel case (first letter uppercase, rest lowercase)
//     function toCamelCase(str) {
//       if (!str) return '';

//       return str.split(' ')
//         .map(word => {
//           // Check if the word is an initial (1-2 letters)
//           if (word.length <= 2) {
//             return word.toUpperCase(); // Make initials all uppercase
//           } else {
//             // Otherwise capitalize first letter, rest lowercase
//             return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
//           }
//         })
//         .join(' ');
//     }

//     // Format date function
//     const formatDate = (dateString) => {
//       if (!dateString || dateString === 'In Progress') return 'In Progress';

//       const date = new Date(dateString);
//       const day = date.getDate().toString().padStart(2, '0');
//       const month = date.toLocaleString('en-US', { month: 'short' });
//       const year = date.getFullYear();

//       return `${day} ${month} ${year}`;
//     };

//     // const completionDate = batch.expectedFinishingDate ? formatDate(batch.expectedFinishingDate) : (batch.awardedDate ? formatDate(batch.awardedDate) : 'In Progress');
//     let completionDate;

//     console.log("latestAwarded:", latestAwarded.awardedDate);


//     if (latestAwarded.expectedFinishingDate) {
//       completionDate = formatDate(latestAwarded.expectedFinishingDate);
//     } else if (latestAwarded.awardedDate) {
//       completionDate = formatDate(latestAwarded.awardedDate);
//     } else {
//       completionDate = 'In Progress';
//     }

//     // Drawing text with the embedded fonts
//     // Use bold font for important fields like name, course, etc.

//     if (templateConfig.name) {
//       const formattedName = toCamelCase(`${student.fName} ${student.lName}`);
//       firstPage.drawText(formattedName, {
//         x: templateConfig.name.x,
//         y: templateConfig.name.y,
//         size: templateConfig.name.size,
//         font: montserratBold,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.guardianName) {
//       const formattedFatherName = toCamelCase(student.guardianName || 'N/A');
//       firstPage.drawText(formattedFatherName, {
//         x: templateConfig.guardianName.x,
//         y: templateConfig.guardianName.y,
//         size: templateConfig.guardianName.size,
//         font: montserratBold,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.course) {
//       firstPage.drawText(`${student.courseName}`, {
//         x: templateConfig.course.x,
//         y: templateConfig.course.y,
//         size: templateConfig.course.size,
//         font: montserratBold,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.subjects) {
//       firstPage.drawText(`${subjectsList}`, {
//         x: templateConfig.subjects.x,
//         y: templateConfig.subjects.y,
//         size: templateConfig.subjects.size,
//         font: montserratRegular,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.courseDuration) {
//       firstPage.drawText(`${courseDuration}`, {
//         x: templateConfig.courseDuration.x,
//         y: templateConfig.courseDuration.y,
//         size: templateConfig.courseDuration.size,
//         font: montserratRegular,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.completionDate) {
//       firstPage.drawText(`${completionDate}`, {
//         x: templateConfig.completionDate.x,
//         y: templateConfig.completionDate.y,
//         size: templateConfig.completionDate.size,
//         font: montserratRegular,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.location) {
//       firstPage.drawText(`${branchInfo.location || branchInfo.branchName}`, {
//         x: templateConfig.location.x,
//         y: templateConfig.location.y,
//         size: templateConfig.location.size,
//         font: montserratRegular,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.grade) {
//       firstPage.drawText(`${student.grade || 'A'}`, {
//         x: templateConfig.grade.x,
//         y: templateConfig.grade.y,
//         size: templateConfig.grade.size,
//         font: montserratBold,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.certificateId) {
//       firstPage.drawText(`${student.regid}`, {
//         x: templateConfig.certificateId.x,
//         y: templateConfig.certificateId.y,
//         size: templateConfig.certificateId.size,
//         font: montserratRegular,
//         color: rgb(0, 0, 0)
//       });
//     }

//     // Save modified PDF
//     const pdfBytes = await pdfDoc.save();

//     // Set response headers
//     res.setHeader('Content-Type', 'application/pdf');
//     res.setHeader('Content-Disposition', `attachment; filename=Certificate_${regid}.pdf`);
//     res.send(Buffer.from(pdfBytes));

//   } catch (error) {
//     console.error('Error generating certificate:', error);
//     res.status(500).json({ success: false, message: 'Server Error' });
//   }
// });
//july-19-25
// app.get('/api/certificate/download/:regid', async (req, res) => {
//   try {
//     const { regid } = req.params;

//     // Find the student
//     const student = await Registration.findOne({ regid }).lean();
//     if (!student) {
//       return res.status(404).json({ success: false, message: 'Student not found' });
//     }

//     // Find batch - Fixed the query structure
//     const batches = await Batch.find({ assignedStudents: student._id }).lean();
//     console.log("batches:", batches);
//     if (!batches || batches.length === 0) {
//       return res.status(400).json({ success: false, message: 'Student is not assigned to any batch' });
//     }

//     // Get the course information
//     const course = await Course.findOne({ courseName: student.courseName }).lean();
//     if (!course) {
//       console.log(`Course not found with name: ${student.courseName}, using default course information`);
//     }

//     // Get the branch information - using branchId instead of branchCode
//     const branch = await Branch.findOne({ branchId: student.branchId }).lean();
//     console.log("branch", branch);
//     if (!branch) {
//       console.log(`Branch not found with code: ${student.branchId}, using default branch information`);
//       const defaultBranch = {
//         branchName: student.branchName || 'JBK Academy',
//         location: 'Ameerpet'
//       };
//       var branchInfo = defaultBranch;
//     } else {
//       var branchInfo = branch;
//     }

//     // Check payment status
//     let paymentCompleted = student.feeType === 'Single' && student.singlePaymentStatus === 'Paid' ||
//       student.feeType === 'Installment' && student.paymentsPlan?.[student.installmentCount - 1]?.status === 'Paid';
//     if (!paymentCompleted) {
//       return res.status(400).json({ success: false, message: 'Payment not completed' });
//     }

//     // Find the latest awarded batch - Fixed the reduce logic
//     const latestAwarded = batches.reduce((latest, current) => {
//       if (!latest.awardedDate && !current.awardedDate) {
//         return latest; // Return first batch if neither has awardedDate
//       }
//       if (!latest.awardedDate) return current;
//       if (!current.awardedDate) return latest;
//       return new Date(current.awardedDate) > new Date(latest.awardedDate) ? current : latest;
//     });

//     console.log('latestAwarded batch:', latestAwarded);

//     // Calculate course duration - Fixed duration calculation
//     let courseDuration = 'N/A';

//     if (latestAwarded?.duration) {
//       if (typeof latestAwarded.duration === 'object') {
//         // If duration is stored as an object with months/days
//         const { months = 0, days = 0 } = latestAwarded.duration;
//         const monthsText = months > 0 ? `${months} month${months > 1 ? 's' : ''}` : '';
//         const daysText = days > 0 ? `${days} day${days > 1 ? 's' : ''}` : '';
        
//         if (monthsText && daysText) {
//           courseDuration = `${monthsText} and ${daysText}`;
//         } else {
//           courseDuration = monthsText || daysText || 'N/A';
//         }
//       } else if (typeof latestAwarded.duration === 'number') {
//         // If duration is stored as number (assuming months)
//         const months = latestAwarded.duration;
//         courseDuration = `${months} month${months > 1 ? 's' : ''}`;
//       } else if (typeof latestAwarded.duration === 'string') {
//         // If duration is already a formatted string
//         courseDuration = latestAwarded.duration;
//       }
//     } else if (latestAwarded?.startDate && latestAwarded?.expectedFinishingDate) {
//       // Calculate duration from start and end dates if duration field is not available
//       const startDate = new Date(latestAwarded.startDate);
//       const endDate = new Date(latestAwarded.expectedFinishingDate);
//       const diffTime = Math.abs(endDate - startDate);
//       const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
//       const diffMonths = Math.floor(diffDays / 30);
//       const remainingDays = diffDays % 30;
      
//       if (diffMonths > 0 && remainingDays > 0) {
//         courseDuration = `${diffMonths} month${diffMonths > 1 ? 's' : ''} and ${remainingDays} day${remainingDays > 1 ? 's' : ''}`;
//       } else if (diffMonths > 0) {
//         courseDuration = `${diffMonths} month${diffMonths > 1 ? 's' : ''}`;
//       } else {
//         courseDuration = `${diffDays} day${diffDays > 1 ? 's' : ''}`;
//       }
//     }

//     console.log('Calculated courseDuration:', courseDuration);

//     let templateFileName;
//     let templateConfig;
//     const branchName = branchInfo.branchName;

//     // Define template configurations with coordinates for each template
//     const templateConfigs = {
//       'JBK-Academy-Ameerpet.pdf': {
//         name: { x: 290, y: 505, size: 26 },
//         guardianName: { x: 290, y: 440, size: 20 },
//         course: { x: 270, y: 379, size: 20 },
//         subjects: { x: 270, y: 320, size: 18 },
//         courseDuration: { x: 235, y: 250, size: 18 },
//         completionDate: { x: 415, y: 250, size: 18 },
//         location: { x: 200, y: 180, size: 18 },
//         grade: { x: 470, y: 180, size: 18 },
//         certificateId: { x: 473, y: 746, size: 17 }
//       },
//       'Onclick-Digital-Marketing.pdf': {
//         name: { x: 315, y: 320, size: 30 },
//         courseDuration: { x: 230, y: 220, size: 18 },
//         completionDate: { x: 519, y: 220, size: 18 },
//         certificateId: { x: 683, y: 486, size: 17 }
//       },
//       'Raster-FxStudios-Certification.pdf': {
//         name: { x: 330, y: 368, size: 26 },
//         guardianName: { x: 585, y: 374, size: 18 },
//         course: { x: 330, y: 288, size: 20 },
//         subjects: { x: 570, y: 288, size: 18 },
//         courseDuration: { x: 370, y: 230, size: 18 },
//         completionDate: { x: 600, y: 230, size: 18 },
//         location: { x: 340, y: 163, size: 18 },
//         grade: { x: 620, y: 165, size: 18 },
//         certificateId: { x: 499, y: 516, size: 17 }
//       }
//     };

//     if (branchName.includes('JBK') || branchName.includes('Academy')) {
//       templateFileName = 'JBK-Academy-Ameerpet.pdf';
//     } else if (branchName.includes('Onclick') || branchName.includes('Digital Marketing')) {
//       templateFileName = 'Onclick-Digital-Marketing.pdf';
//     } else if (branchName.includes('Raster') || branchName.includes('FX Studios')) {
//       templateFileName = 'Raster-FxStudios-Certification.pdf';
//     } else {
//       // Default template if branch name doesn't match
//       templateFileName = 'JBK-Academy-Ameerpet.pdf';
//     }

//     // Get the configuration for the selected template
//     templateConfig = templateConfigs[templateFileName];

//     // Load the appropriate PDF template
//     const pdfPath = path.join(__dirname, `./certificate/${templateFileName}`);
//     const existingPdfBytes = fs.readFileSync(pdfPath);
//     const pdfDoc = await PDFDocument.load(existingPdfBytes);

//     // Embed fonts
//     const fontPath = path.join(__dirname, './fonts/Montserrat-Bold.ttf');
//     const fontRegularPath = path.join(__dirname, './fonts/Montserrat-Regular.ttf');

//     let montserratBold, montserratRegular;
//     try {
//       const boldFontBytes = fs.readFileSync(fontPath);
//       const regularFontBytes = fs.readFileSync(fontRegularPath);

//       montserratBold = await pdfDoc.embedFont(boldFontBytes);
//       montserratRegular = await pdfDoc.embedFont(regularFontBytes);
//     } catch (error) {
//       console.log('Could not load custom fonts, using standard font:', error.message);
//       montserratBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
//       montserratRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
//     }

//     const pages = pdfDoc.getPages();
//     const firstPage = pages[0];

//     // Get subject list from course schema
//     let subjectsList = 'N/A';
//     if (course && course.subjects && course.subjects.length > 0) {
//       subjectsList = course.subjects.map(subject => subject.subjectName).join(', ');
//     } else {
//       subjectsList = student.courseSubject || student.courseName;
//     }

//     // Function to convert a string to camel case
//     function toCamelCase(str) {
//       if (!str) return '';
//       return str.split(' ')
//         .map(word => {
//           if (word.length <= 2) {
//             return word.toUpperCase();
//           } else {
//             return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
//           }
//         })
//         .join(' ');
//     }

//     // Format date function
//     const formatDate = (dateString) => {
//       if (!dateString || dateString === 'In Progress') return 'In Progress';
//       const date = new Date(dateString);
//       const day = date.getDate().toString().padStart(2, '0');
//       const month = date.toLocaleString('en-US', { month: 'short' });
//       const year = date.getFullYear();
//       return `${day} ${month} ${year}`;
//     };

//     // Calculate completion date
//     let completionDate;
//     console.log("latestAwarded.awardedDate:", latestAwarded.awardedDate);

//     if (latestAwarded.expectedFinishingDate) {
//       completionDate = formatDate(latestAwarded.expectedFinishingDate);
//     } else if (latestAwarded.awardedDate) {
//       completionDate = formatDate(latestAwarded.awardedDate);
//     } else {
//       completionDate = 'In Progress';
//     }

//     // Drawing text with the embedded fonts
//     if (templateConfig.name) {
//       const formattedName = toCamelCase(`${student.fName} ${student.lName}`);
//       firstPage.drawText(formattedName, {
//         x: templateConfig.name.x,
//         y: templateConfig.name.y,
//         size: templateConfig.name.size,
//         font: montserratBold,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.guardianName) {
//       const formattedFatherName = toCamelCase(student.guardianName || 'N/A');
//       firstPage.drawText(formattedFatherName, {
//         x: templateConfig.guardianName.x,
//         y: templateConfig.guardianName.y,
//         size: templateConfig.guardianName.size,
//         font: montserratBold,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.course) {
//       firstPage.drawText(`${student.courseName}`, {
//         x: templateConfig.course.x,
//         y: templateConfig.course.y,
//         size: templateConfig.course.size,
//         font: montserratBold,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.subjects) {
//       firstPage.drawText(`${subjectsList}`, {
//         x: templateConfig.subjects.x,
//         y: templateConfig.subjects.y,
//         size: templateConfig.subjects.size,
//         font: montserratRegular,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.courseDuration) {
//       console.log('Adding courseDuration to PDF:', courseDuration);
//       firstPage.drawText(`${courseDuration}`, {
//         x: templateConfig.courseDuration.x,
//         y: templateConfig.courseDuration.y,
//         size: templateConfig.courseDuration.size,
//         font: montserratRegular,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.completionDate) {
//       firstPage.drawText(`${completionDate}`, {
//         x: templateConfig.completionDate.x,
//         y: templateConfig.completionDate.y,
//         size: templateConfig.completionDate.size,
//         font: montserratRegular,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.location) {
//       firstPage.drawText(`${branchInfo.location || branchInfo.branchName}`, {
//         x: templateConfig.location.x,
//         y: templateConfig.location.y,
//         size: templateConfig.location.size,
//         font: montserratRegular,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.grade) {
//       firstPage.drawText(`${student.grade || 'A'}`, {
//         x: templateConfig.grade.x,
//         y: templateConfig.grade.y,
//         size: templateConfig.grade.size,
//         font: montserratBold,
//         color: rgb(0, 0, 0)
//       });
//     }

//     if (templateConfig.certificateId) {
//       firstPage.drawText(`${student.regid}`, {
//         x: templateConfig.certificateId.x,
//         y: templateConfig.certificateId.y,
//         size: templateConfig.certificateId.size,
//         font: montserratRegular,
//         color: rgb(0, 0, 0)
//       });
//     }

//     // Save modified PDF
//     const pdfBytes = await pdfDoc.save();

//     // Set response headers
//     res.setHeader('Content-Type', 'application/pdf');
//     res.setHeader('Content-Disposition', `attachment; filename=Certificate_${regid}.pdf`);
//     res.send(Buffer.from(pdfBytes));

//   } catch (error) {
//     console.error('Error generating certificate:', error);
//     res.status(500).json({ success: false, message: 'Server Error' });
//   }
// });
// app.get('/api/certificate/download/:regid', async (req, res) => {
//   try {
//     const { regid } = req.params;

//     // Find the student
//     const student = await Registration.findOne({ regid }).lean();
//     if (!student) {
//       return res.status(404).json({ success: false, message: 'Student not found' });
//     }

//     // Find batch - Fixed the query structure
//     const batches = await Batch.find({ assignedStudents: student._id }).lean();
//     console.log("batches:", batches);
//     if (!batches || batches.length === 0) {
//       return res.status(400).json({ success: false, message: 'Student is not assigned to any batch' });
//     }

//     // Get the course information
//     const course = await Course.findOne({ courseName: student.courseName }).lean();
//     if (!course) {
//       console.log(`Course not found with name: ${student.courseName}, using default course information`);
//     }

//     // Get the branch information - using branchId instead of branchCode
//     const branch = await Branch.findOne({ branchId: student.branchId }).lean();
//     console.log("branch", branch);
//     if (!branch) {
//       console.log(`Branch not found with code: ${student.branchId}, using default branch information`);
//       const defaultBranch = {
//         branchName: student.branchName || 'JBK Academy',
//         location: 'Ameerpet'
//       };
//       var branchInfo = defaultBranch;
//     } else {
//       var branchInfo = branch;
//     }

//     // Check payment status
//     let paymentCompleted = student.feeType === 'Single' && student.singlePaymentStatus === 'Paid' ||
//       student.feeType === 'Installment' && student.paymentsPlan?.[student.installmentCount - 1]?.status === 'Paid';
//     if (!paymentCompleted) {
//       return res.status(400).json({ success: false, message: 'Payment not completed' });
//     }

//     // Find the latest awarded batch - Fixed the reduce logic
//     const latestAwarded = batches.reduce((latest, current) => {
//       if (!latest.awardedDate && !current.awardedDate) {
//         return latest; // Return first batch if neither has awardedDate
//       }
//       if (!latest.awardedDate) return current;
//       if (!current.awardedDate) return latest;
//       return new Date(current.awardedDate) > new Date(latest.awardedDate) ? current : latest;
//     });

//     console.log('latestAwarded batch:', latestAwarded);

//     // Calculate course duration - Fixed duration calculation
//     let courseDuration = 'N/A';

//     if (latestAwarded?.duration) {
//       if (typeof latestAwarded.duration === 'object') {
//         // If duration is stored as an object with months/days
//         const { months = 0, days = 0 } = latestAwarded.duration;
//         const monthsText = months > 0 ? `${months} month${months > 1 ? 's' : ''}` : '';
//         const daysText = days > 0 ? `${days} day${days > 1 ? 's' : ''}` : '';
        
//         if (monthsText && daysText) {
//           courseDuration = `${monthsText} and ${daysText}`;
//         } else {
//           courseDuration = monthsText || daysText || 'N/A';
//         }
//       } else if (typeof latestAwarded.duration === 'number') {
//         // If duration is stored as number (assuming months)
//         const months = latestAwarded.duration;
//         courseDuration = `${months} month${months > 1 ? 's' : ''}`;
//       } else if (typeof latestAwarded.duration === 'string') {
//         // If duration is already a formatted string
//         courseDuration = latestAwarded.duration;
//       }
//     } else if (latestAwarded?.startDate && latestAwarded?.expectedFinishingDate) {
//       // Calculate duration from start and end dates if duration field is not available
//       const startDate = new Date(latestAwarded.startDate);
//       const endDate = new Date(latestAwarded.expectedFinishingDate);
//       const diffTime = Math.abs(endDate - startDate);
//       const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
//       const diffMonths = Math.floor(diffDays / 30);
//       const remainingDays = diffDays % 30;
      
//       if (diffMonths > 0 && remainingDays > 0) {
//         courseDuration = `${diffMonths} month${diffMonths > 1 ? 's' : ''} and ${remainingDays} day${remainingDays > 1 ? 's' : ''}`;
//       } else if (diffMonths > 0) {
//         courseDuration = `${diffMonths} month${diffMonths > 1 ? 's' : ''}`;
//       } else {
//         courseDuration = `${diffDays} day${diffDays > 1 ? 's' : ''}`;
//       }
//     }

//     console.log('Calculated courseDuration:', courseDuration);

//     let templateFileName;
//     let templateConfig;
//     const branchName = branchInfo.branchName;

//     // Updated template configurations with proper coordinates for each template
//     const templateConfigs = {
//       'JBK-Academy-Ameerpet.pdf': {
//         // Main title "This is to certify that" - positioned above the name
//         certifyTitle: { x: 100, y: 350, size: 16 },
        
//         // Student name - centered under "This is to certify that"
//         name: { x:360, y: 530, size: 24 },
//         nameLabel: { x: 360, y: 504, size: 18 },
        
//         // Guardian/Father name - positioned below student name
//         guardianName: { x: 360, y: 470, size: 20},
//         guardianLabel: { x: 360, y: 440, size: 16 },
        
//         // Course name - positioned below guardian name
//         course: { x: 360, y: 410, size: 18 },
//         courseLabel: { x: 360, y: 390, size: 16 },
        
//         // Subjects/Software covered - positioned below course
//         subjects: { x: 360, y: 350, size: 16 },
//         subjectsLabel: { x: 360, y: 330, size: 16 },
        
//         // Course duration - left side bottom section
//         courseDuration: { x: 250, y: 300, size: 16 },
//         courseDurationLabel: { x: 250, y: 280, size: 12 },
        
//         // Completion/Awarded date - right side bottom section
//         completionDate: { x: 420, y: 300, size: 16 },
//         completionDateLabel: { x: 420, y: 280, size: 12 },
        
//         // Training centre/location - left side lower
//         location: { x: 250, y: 230, size: 16 },
//         locationLabel: { x: 250, y: 200, size: 12 },
        
//         // Grade - right side lower
//         grade: { x: 420, y: 230, size: 18 },
//         gradeLabel: { x: 420, y: 200, size: 12 },
        
//         // Certificate ID - bottom right corner
//         certificateId: { x: 420, y: 750, size: 12 }
//       },
//       'Onclick-Digital-Marketing.pdf': {
//         certifyTitle: { x: 180, y: 400, size: 18 },
//         name: { x: 315, y: 350, size: 30 },
//         nameLabel: { x: 380, y: 325, size: 14 },
//         courseDuration: { x: 200, y: 250, size: 18 },
//         courseDurationLabel: { x: 210, y: 225, size: 14 },
//         completionDate: { x: 490, y: 250, size: 18 },
//         completionDateLabel: { x: 500, y: 225, size: 14 },
//         certificateId: { x: 650, y: 120, size: 14 }
//       },
//       'Raster-FxStudios-Certification.pdf': {
//         certifyTitle: { x: 180, y: 450, size: 18 },
//         name: { x: 330, y: 398, size: 26 },
//         nameLabel: { x: 380, y: 375, size: 14 },
//         guardianName: { x: 520, y: 398, size: 18 },
//         guardianLabel: { x: 540, y: 375, size: 14 },
//         course: { x: 330, y: 318, size: 20 },
//         courseLabel: { x: 380, y: 295, size: 14 },
//         subjects: { x: 520, y: 318, size: 18 },
//         subjectsLabel: { x: 540, y: 295, size: 14 },
//         courseDuration: { x: 340, y: 260, size: 18 },
//         courseDurationLabel: { x: 350, y: 235, size: 14 },
//         completionDate: { x: 570, y: 260, size: 18 },
//         completionDateLabel: { x: 580, y: 235, size: 14 },
//         location: { x: 310, y: 193, size: 18 },
//         locationLabel: { x: 320, y: 170, size: 14 },
//         grade: { x: 590, y: 195, size: 18 },
//         gradeLabel: { x: 600, y: 170, size: 14 },
//         certificateId: { x: 469, y: 120, size: 14 }
//       }
//     };

//     if (branchName.includes('JBK') || branchName.includes('Academy')) {
//       templateFileName = 'JBK-Academy-Ameerpet.pdf';
//     } else if (branchName.includes('Onclick') || branchName.includes('Digital Marketing')) {
//       templateFileName = 'Onclick-Digital-Marketing.pdf';
//     } else if (branchName.includes('Raster') || branchName.includes('FX Studios')) {
//       templateFileName = 'Raster-FxStudios-Certification.pdf';
//     } else {
//       // Default template if branch name doesn't match
//       templateFileName = 'JBK-Academy-Ameerpet.pdf';
//     }

//     // Get the configuration for the selected template
//     templateConfig = templateConfigs[templateFileName];

//     // Load the appropriate PDF template
//     const pdfPath = path.join(__dirname, `./certificate/${templateFileName}`);
//     const existingPdfBytes = fs.readFileSync(pdfPath);
//     const pdfDoc = await PDFDocument.load(existingPdfBytes);

//     // Embed fonts
//     const fontPath = path.join(__dirname, './fonts/Montserrat-Bold.ttf');
//     const fontRegularPath = path.join(__dirname, './fonts/Montserrat-Regular.ttf');

//     let montserratBold, montserratRegular;
//     try {
//       const boldFontBytes = fs.readFileSync(fontPath);
//       const regularFontBytes = fs.readFileSync(fontRegularPath);

//       montserratBold = await pdfDoc.embedFont(boldFontBytes);
//       montserratRegular = await pdfDoc.embedFont(regularFontBytes);
//     } catch (error) {
//       console.log('Could not load custom fonts, using standard font:', error.message);
//       montserratBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
//       montserratRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
//     }

//     const pages = pdfDoc.getPages();
//     const firstPage = pages[0];

//     // Get subject list from course schema - Using the corrected logic from second version
//     let subjectsList = 'N/A';
//     if (course && course.subjects && course.subjects.length > 0) {
//       subjectsList = course.subjects.map(subject => subject.subjectName).join(', ');
//     } else {
//       subjectsList = student.courseSubject || student.courseName;
//     }

//     // Function to convert a string to camel case
//     function toCamelCase(str) {
//       if (!str) return '';
//       return str.split(' ')
//         .map(word => {
//           if (word.length <= 2) {
//             return word.toUpperCase();
//           } else {
//             return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
//           }
//         })
//         .join(' ');
//     }

//     // Function to draw centered underlined text with extended underline
//     function drawCenteredUnderlinedText(page, text, x, y, size, font, color = rgb(0, 0, 0)) {
//       // Calculate text width for centering
//       const textWidth = font.widthOfTextAtSize(text, size);
//       const centeredX = x - (textWidth / 2);
      
//       // Draw the text
//       page.drawText(text, {
//         x: centeredX,
//         y: y,
//         size: size,
//         font: font,
//         color: color
//       });
      
//       // Extended underline - increased by 4 more character spaces on each side
//       const charWidth = font.widthOfTextAtSize('M', size);
//       const underlineExtension = (2 + 4) * charWidth / 10; // Extended from 2 to 6 characters worth
//       page.drawLine({
//         start: { x: centeredX - underlineExtension, y: y - 5 },
//         end: { x: centeredX + textWidth + underlineExtension, y: y - 5 },
//         thickness: 3,
//         color: color
//       });
//     }

//     // Function to draw left-aligned underlined text with extended underline
//     function drawLeftAlignedUnderlinedText(page, text, x, y, size, font, color = rgb(0, 0, 0)) {
//       // Draw the text
//       page.drawText(text, {
//         x: x,
//         y: y,
//         size: size,
//         font: font,
//         color: color
//       });
      
//       // Calculate text width for underline
//       const textWidth = font.widthOfTextAtSize(text, size);
      
//       // Extended underline - increased by 4 more character spaces on each side
//       const charWidth = font.widthOfTextAtSize('M', size);
//       const underlineExtension = (2 + 4) * charWidth / 10; // Extended from 2 to 6 characters worth
//       page.drawLine({
//         start: { x: x - underlineExtension, y: y - 5 },
//         end: { x: x + textWidth + underlineExtension, y: y - 5 },
//         thickness: 3,
//         color: color
//       });
//     }

//     // Format date function
//     const formatDate = (dateString) => {
//       if (!dateString || dateString === 'In Progress') return 'In Progress';
//       const date = new Date(dateString);
//       const day = date.getDate().toString().padStart(2, '0');
//       const month = date.toLocaleString('en-US', { month: 'short' });
//       const year = date.getFullYear();
//       return `${day} ${month} ${year}`;
//     };

//     // Calculate completion date
//     let completionDate;
//     console.log("latestAwarded.awardedDate:", latestAwarded.awardedDate);

//     if (latestAwarded.expectedFinishingDate) {
//       completionDate = formatDate(latestAwarded.expectedFinishingDate);
//     } else if (latestAwarded.awardedDate) {
//       completionDate = formatDate(latestAwarded.awardedDate);
//     } else {
//       completionDate = 'In Progress';
//     }

//     // Drawing text with labels and proper formatting
    
//     // Main certification title - positioned above student name
//     if (templateConfig.certifyTitle) {
//       const titleText = 'This is to certify that';
//       const titleWidth = montserratRegular.widthOfTextAtSize(titleText, templateConfig.certifyTitle.size);
//       firstPage.drawText(titleText, {
//         x: templateConfig.certifyTitle.x - (titleWidth / 2),
//         y: templateConfig.certifyTitle.y,
//         size: templateConfig.certifyTitle.size,
//         font: montserratRegular,
//         color: rgb(0, 0, 0)
//       });
//     }

//     // Student Name - centered with extended underline
//     if (templateConfig.name) {
//       const formattedName = toCamelCase(`${student.fName} ${student.lName}`);
//       drawCenteredUnderlinedText(
//         firstPage,
//         formattedName,
//         templateConfig.name.x,
//         templateConfig.name.y,
//         templateConfig.name.size,
//         montserratBold
//       );
      
//       // Name label - positioned below and centered
//       if (templateConfig.nameLabel) {
//         const labelText = 'Name';
//         const labelWidth = montserratRegular.widthOfTextAtSize(labelText, templateConfig.nameLabel.size);
//         firstPage.drawText(labelText, {
//           x: templateConfig.nameLabel.x - (labelWidth / 2),
//           y: templateConfig.nameLabel.y,
//           size: templateConfig.nameLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Guardian Name - centered with extended underline
//     if (templateConfig.guardianName) {
//       const formattedFatherName = toCamelCase(student.guardianName || 'N/A');
//       drawCenteredUnderlinedText(
//         firstPage,
//         formattedFatherName,
//         templateConfig.guardianName.x,
//         templateConfig.guardianName.y,
//         templateConfig.guardianName.size,
//         montserratBold
//       );
      
//       // Guardian label - centered
//       if (templateConfig.guardianLabel) {
//         const labelText = 'S/o D/o W/o';
//         const labelWidth = montserratRegular.widthOfTextAtSize(labelText, templateConfig.guardianLabel.size);
//         firstPage.drawText(labelText, {
//           x: templateConfig.guardianLabel.x - (labelWidth / 2),
//           y: templateConfig.guardianLabel.y,
//           size: templateConfig.guardianLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Course Name - centered with extended underline
//     if (templateConfig.course) {
//       drawCenteredUnderlinedText(
//         firstPage,
//         student.courseName,
//         templateConfig.course.x,
//         templateConfig.course.y,
//         templateConfig.course.size,
//         montserratBold
//       );
      
//       // Course label - centered
//       if (templateConfig.courseLabel) {
//         const labelText = 'Course Title';
//         const labelWidth = montserratRegular.widthOfTextAtSize(labelText, templateConfig.courseLabel.size);
//         firstPage.drawText(labelText, {
//           x: templateConfig.courseLabel.x - (labelWidth / 2),
//           y: templateConfig.courseLabel.y,
//           size: templateConfig.courseLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Subjects - centered with extended underline
//     if (templateConfig.subjects) {
//       drawCenteredUnderlinedText(
//         firstPage,
//         subjectsList,
//         templateConfig.subjects.x,
//         templateConfig.subjects.y,
//         templateConfig.subjects.size,
//         montserratRegular
//       );
      
//       // Subjects label - centered
//       if (templateConfig.subjectsLabel) {
//         const labelText = 'Software Covered';
//         const labelWidth = montserratRegular.widthOfTextAtSize(labelText, templateConfig.subjectsLabel.size);
//         firstPage.drawText(labelText, {
//           x: templateConfig.subjectsLabel.x - (labelWidth / 2),
//           y: templateConfig.subjectsLabel.y,
//           size: templateConfig.subjectsLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Course Duration - left aligned with extended underline
//     if (templateConfig.courseDuration) {
//       drawLeftAlignedUnderlinedText(
//         firstPage,
//         courseDuration,
//         templateConfig.courseDuration.x,
//         templateConfig.courseDuration.y,
//         templateConfig.courseDuration.size,
//         montserratRegular
//       );
      
//       // Course duration label
//       if (templateConfig.courseDurationLabel) {
//         firstPage.drawText('Course Duration', {
//           x: templateConfig.courseDurationLabel.x,
//           y: templateConfig.courseDurationLabel.y,
//           size: templateConfig.courseDurationLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Completion Date - left aligned with extended underline
//     if (templateConfig.completionDate) {
//       drawLeftAlignedUnderlinedText(
//         firstPage,
//         completionDate,
//         templateConfig.completionDate.x,
//         templateConfig.completionDate.y,
//         templateConfig.completionDate.size,
//         montserratRegular
//       );
      
//       // Completion date label
//       if (templateConfig.completionDateLabel) {
//         firstPage.drawText('Awarded On', {
//           x: templateConfig.completionDateLabel.x,
//           y: templateConfig.completionDateLabel.y,
//           size: templateConfig.completionDateLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Location - left aligned with extended underline
//     if (templateConfig.location) {
//       drawLeftAlignedUnderlinedText(
//         firstPage,
//         branchInfo.location || branchInfo.branchName,
//         templateConfig.location.x,
//         templateConfig.location.y,
//         templateConfig.location.size,
//         montserratRegular
//       );
      
//       // Location label
//       if (templateConfig.locationLabel) {
//         firstPage.drawText('Training Centre', {
//           x: templateConfig.locationLabel.x,
//           y: templateConfig.locationLabel.y,
//           size: templateConfig.locationLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Grade - left aligned with extended underline
//     if (templateConfig.grade) {
//       drawLeftAlignedUnderlinedText(
//         firstPage,
//         student.grade || 'A',
//         templateConfig.grade.x,
//         templateConfig.grade.y,
//         templateConfig.grade.size,
//         montserratBold
//       );
      
//       // Grade label
//       if (templateConfig.gradeLabel) {
//         firstPage.drawText('Grade', {
//           x: templateConfig.gradeLabel.x,
//           y: templateConfig.gradeLabel.y,
//           size: templateConfig.gradeLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Certificate ID - positioned at bottom right
//     if (templateConfig.certificateId) {
//       firstPage.drawText(`Certificate ID: ${student.regid}`, {
//         x: templateConfig.certificateId.x,
//         y: templateConfig.certificateId.y,
//         size: templateConfig.certificateId.size,
//         font: montserratRegular,
//         color: rgb(0.5, 0.5, 0.5) // Lighter gray color for certificate ID
//       });
//     }

//     // Save modified PDF
//     const pdfBytes = await pdfDoc.save();

//     // Set response headers
//     res.setHeader('Content-Type', 'application/pdf');
//     res.setHeader('Content-Disposition', `attachment; filename=Certificate_${regid}.pdf`);
//     res.send(Buffer.from(pdfBytes));

//   } catch (error) {
//     console.error('Error generating certificate:', error);
//     res.status(500).json({ success: false, message: 'Server Error' });
//   }
// });
// app.get('/api/certificate/download/:regid', async (req, res) => {
//   try {
//     const { regid } = req.params;

//     // Find the student
//     const student = await Registration.findOne({ regid }).lean();
//     if (!student) {
//       return res.status(404).json({ success: false, message: 'Student not found' });
//     }

//     // Find batch - Fixed the query structure
//     const batches = await Batch.find({ assignedStudents: student._id }).lean();
//     console.log("batches:", batches);
//     if (!batches || batches.length === 0) {
//       return res.status(400).json({ success: false, message: 'Student is not assigned to any batch' });
//     }

//     // Get the course information
//     const course = await Course.findOne({ CourseName: student.courseName }).lean();
//     if (!course) {
//       console.log(`Course not found with name: ${student.courseName}, using default course information`);
//     }

//     // Get the branch information - using branchId instead of branchCode
//     const branch = await Branch.findOne({ branchId: student.branchId }).lean();
//     console.log("branch", branch);
//     if (!branch) {
//       console.log(`Branch not found with code: ${student.branchId}, using default branch information`);
//       const defaultBranch = {
//         branchName: student.branchName || 'JBK Academy',
//         location: 'Ameerpet'
//       };
//       var branchInfo = defaultBranch;
//     } else {
//       var branchInfo = branch;
//     }

//     // Check payment status
//     let paymentCompleted = student.feeType === 'Single' && student.singlePaymentStatus === 'Paid' ||
//       student.feeType === 'Installment' && student.paymentsPlan?.[student.installmentCount - 1]?.status === 'Paid';
//     if (!paymentCompleted) {
//       return res.status(400).json({ success: false, message: 'Payment not completed' });
//     }

//     // Find the latest awarded batch - Fixed the reduce logic
//     const latestAwarded = batches.reduce((latest, current) => {
//       if (!latest.awardedDate && !current.awardedDate) {
//         return latest; // Return first batch if neither has awardedDate
//       }

//       if (!latest.awardedDate) return current;
//       if (!current.awardedDate) return latest;
//       return new Date(current.awardedDate) > new Date(latest.awardedDate) ? current : latest;
//     });

//     console.log('latestAwarded batch:', latestAwarded);

//     // Calculate course duration - Fixed duration calculation
//     let courseDuration = 'N/A';

//     if (latestAwarded?.duration) {
//       if (typeof latestAwarded.duration === 'object') {
//         // If duration is stored as an object with months/days
//         const { months = 0, days = 0 } = latestAwarded.duration;
//         const monthsText = months > 0 ? `${months} month${months > 1 ? 's' : ''}` : '';
//         const daysText = days > 0 ? `${days} day${days > 1 ? 's' : ''}` : '';

//         if (monthsText && daysText) {
//           courseDuration = `${monthsText} and ${daysText}`;
//         } else {
//           courseDuration = monthsText || daysText || 'N/A';
//         }
//       } else if (typeof latestAwarded.duration === 'number') {
//         // If duration is stored as number (assuming months)
//         const months = latestAwarded.duration;
//         courseDuration = `${months} month${months > 1 ? 's' : ''}`;
//       } else if (typeof latestAwarded.duration === 'string') {
//         // If duration is already a formatted string
//         courseDuration = latestAwarded.duration;
//       }
//     } else if (latestAwarded?.startDate && latestAwarded?.expectedFinishingDate) {
//       // Calculate duration from start and end dates if duration field is not available
//       const startDate = new Date(latestAwarded.startDate);
//       const endDate = new Date(latestAwarded.expectedFinishingDate);
//       const diffTime = Math.abs(endDate - startDate);
//       const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
//       const diffMonths = Math.floor(diffDays / 30);
//       const remainingDays = diffDays % 30;

//       if (diffMonths > 0 && remainingDays > 0) {
//         courseDuration = `${diffMonths} month${diffMonths > 1 ? 's' : ''} and ${remainingDays} day${remainingDays > 1 ? 's' : ''}`;
//       } else if (diffMonths > 0) {
//         courseDuration = `${diffMonths} month${diffMonths > 1 ? 's' : ''}`;
//       } else {
//         courseDuration = `${diffDays} day${diffDays > 1 ? 's' : ''}`;
//       }
//     }

//     console.log('Calculated courseDuration:', course);

//     let templateFileName;
//     let templateConfig;
//     const branchName = branchInfo.branchName;
//     courseDuration = (String(course.duration.value)+" "+course.duration.unit)
//     // Updated template configurations with proper coordinates for each template
//     const templateConfigs = {
//       'JBK-Academy-Ameerpet.pdf': {
//         // Main title "This is to certify that" - positioned above the name
//         certifyTitle: { x: 100, y: 350, size: 16 },

//         // Student name - centered under "This is to certify that"
//         name: { x: 360, y: 530, size: 16 },
//         nameLabel: { x: 360, y: 509, size: 14 },

//         // Guardian/Father name - positioned below student name
//         guardianName: { x: 360, y: 470, size: 16 },
//         guardianLabel: { x: 360, y: 448, size: 14 },

//         // Course name - positioned below guardian name
//         course: { x: 360, y: 390, size: 16 },
//         courseLabel: { x: 360, y: 368, size: 14 },

//         // Subjects/Software covered - positioned below course
//         subjects: { x: 360, y: 330, size: 16 },
//         subjectsLabel: { x: 360, y: 308, size: 14 },

//         // Course duration - left side bottom section
//         courseDuration: { x: 250, y: 250, size: 16 },
//         courseDurationLabel: { x: 230, y: 230, size: 14 },

//         // Completion/Awarded date - right side bottom section
//         completionDate: { x: 420, y: 250, size: 16 },
//         completionDateLabel: { x: 440, y: 230, size: 14 },

//         // Training centre/location - left side lower
//         location: { x: 250, y: 180, size: 16 },
//         locationLabel: { x: 227, y: 160, size: 14 },

//         // Grade - right side lower
//         grade: { x: 420, y: 180, size: 18 },
//         gradeLabel: { x: 455, y: 160, size: 14 },

//         // Certificate ID - bottom right corner
//         certificateId: { x: 420, y: 765, size: 15 }
//       },
//       'Onclick-Digital-Marketing.pdf': {
//         certifyTitle: { x: 180, y: 400, size: 18 },
//         name: { x: 315, y: 350, size: 30 },
//         nameLabel: { x: 380, y: 325, size: 14 },
//         courseDuration: { x: 200, y: 250, size: 18 },
//         courseDurationLabel: { x: 210, y: 225, size: 14 },
//         completionDate: { x: 490, y: 250, size: 18 },
//         completionDateLabel: { x: 500, y: 225, size: 14 },
//         certificateId: { x: 650, y: 120, size: 14 }
//       },
//       'Raster-FxStudios-Certification.pdf': {
//         certifyTitle: { x: 180, y: 450, size: 18 },
//         name: { x: 330, y: 398, size: 26 },
//         nameLabel: { x: 380, y: 375, size: 14 },
//         guardianName: { x: 520, y: 398, size: 18 },
//         guardianLabel: { x: 540, y: 375, size: 14 },
//         course: { x: 330, y: 318, size: 20 },
//         courseLabel: { x: 380, y: 295, size: 14 },
//         subjects: { x: 520, y: 318, size: 18 },
//         subjectsLabel: { x: 540, y: 295, size: 14 },
//         courseDuration: { x: 340, y: 260, size: 18 },
//         courseDurationLabel: { x: 350, y: 235, size: 14 },
//         completionDate: { x: 570, y: 260, size: 18 },
//         completionDateLabel: { x: 580, y: 235, size: 14 },
//         location: { x: 310, y: 193, size: 18 },
//         locationLabel: { x: 320, y: 170, size: 14 },
//         grade: { x: 590, y: 195, size: 18 },
//         gradeLabel: { x: 600, y: 170, size: 14 },
//         certificateId: { x: 469, y: 120, size: 14 }
//       }
//     };

//     if (branchName.includes('JBK') || branchName.includes('Academy')) {
//       templateFileName = 'JBK-Academy-Ameerpet.pdf';
//     } else if (branchName.includes('Onclick') || branchName.includes('Digital Marketing')) {
//       templateFileName = 'Onclick-Digital-Marketing.pdf';
//     } else if (branchName.includes('Raster') || branchName.includes('FX Studios')) {
//       templateFileName = 'Raster-FxStudios-Certification.pdf';
//     } else {
//       // Default template if branch name doesn't match
//       templateFileName = 'JBK-Academy-Ameerpet.pdf';
//     }

//     // Get the configuration for the selected template
//     templateConfig = templateConfigs[templateFileName];

//     // Load the appropriate PDF template
//     const pdfPath = path.join(__dirname, `./certificate/${templateFileName}`);
//     const existingPdfBytes = fs.readFileSync(pdfPath);
//     const pdfDoc = await PDFDocument.load(existingPdfBytes);
//     const [page] = pdfDoc.getPages();
//     const { width, height } = page.getSize();
//     // Embed fonts
//     const fontPath = path.join(__dirname, './fonts/Montserrat-Bold.ttf');
//     const fontRegularPath = path.join(__dirname, './fonts/Montserrat-Regular.ttf');

//     let montserratBold, montserratRegular;
//     try {
//       const boldFontBytes = fs.readFileSync(fontPath);
//       const regularFontBytes = fs.readFileSync(fontRegularPath);

//       montserratBold = await pdfDoc.embedFont(boldFontBytes);
//       montserratRegular = await pdfDoc.embedFont(regularFontBytes);
//     } catch (error) {
//       console.log('Could not load custom fonts, using standard font:', error.message);
//       montserratBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
//       montserratRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
//     }

//     const pages = pdfDoc.getPages();
//     const firstPage = pages[0];

//     // FIXED: Get subject list from selectedSubjects field properly
//     let subjectsList = 'N/A';
//     try {
//       if (student.selectedSubjects && student.selectedSubjects.length > 0) {
//         // Fetch the actual subject documents using the ObjectIds
//         const subjects = await Subject.find({
//           _id: { $in: student.selectedSubjects }
//         }).lean();

//         if (subjects && subjects.length > 0) {
//           // Extract SubjectName from each subject document
//           subjectsList = subjects.map(subject => subject.SubjectName).join(', ');
//           console.log('Retrieved subjects from selectedSubjects:', subjectsList);
//         } else {
//           console.log('No subjects found for selectedSubjects ObjectIds');
//           // Fallback to course subjects if selectedSubjects lookup fails
//           if (course && course.subjects && course.subjects.length > 0) {
//             subjectsList = course.subjects.map(subject => subject.subjectName).join(', ');
//           } else {
//             subjectsList = student.courseSubject || student.courseName || 'N/A';
//           }
//         }
//       } else if (course && course.subjects && course.subjects.length > 0) {
//         // Fallback to course subjects if no selectedSubjects
//         subjectsList = course.subjects.map(subject => subject.subjectName).join(', ');
//         console.log('Retrieved subjects from course schema:', subjectsList);
//       } else {
//         // Final fallback to student fields
//         subjectsList = student.courseSubject || student.courseName || 'N/A';
//         console.log('Used fallback subjects:', subjectsList);
//       }
//     } catch (error) {
//       console.error('Error fetching subjects:', error);
//       // Use fallback in case of error
//       subjectsList = student.courseSubject || student.courseName || 'N/A';
//     }

//     console.log('Final subjects list for certificate:', subjectsList);

//     // Function to convert a string to camel case
//     function toCamelCase(str) {
//       if (!str) return '';
//       return str.split(' ')
//         .map(word => {
//           if (word.length <= 2) {
//             return word.toUpperCase();
//           } else {
//             return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
//           }
//         })
//         .join(' ');
//     }

//     // Function to draw centered underlined text with extended underline
//     function drawCenteredUnderlinedText(page, text, x, y, size, font, color = rgb(0, 0, 0)) {
//       // Calculate text width for centering
//       const textWidth = font.widthOfTextAtSize(text, size);
//       const centeredX = x - (textWidth / 2);

//       // Draw the text
//       page.drawText(text, {
//         x: centeredX,
//         y: y,
//         size: size,
//         font: font,
//         color: color
//       });


//       page.drawLine({
//         start: { x: (width - 400), y: y - 5 },
//         end: { x: (width - 50), y: y - 5 },
//         thickness: 2.5,
//         color: color
//       });
//     }

//     // Function to draw left-aligned underlined text with extended underline
//     // function drawLeftAlignedUnderlinedText(page, text, x, y, size, font, color = rgb(0, 0, 0)) {
//     //   // Draw the text
//     //   page.drawText(text, {
//     //     x: x,
//     //     y: y,
//     //     size: size,
//     //     font: font,
//     //     color: color
//     //   });

//     //   // Calculate text width for underline
//     //   const textWidth = font.widthOfTextAtSize(text, size);

//     //   // Extended underline - increased by 4 more character spaces on each side
//     //   const charWidth = font.widthOfTextAtSize('M', size);
//     //   const underlineExtension = (2 + 4) * charWidth / 10; // Extended from 2 to 6 characters worth
//     //   page.drawLine({
//     //     start: { x: x - underlineExtension, y: y - 5 },
//     //     end: { x: x + textWidth + underlineExtension, y: y - 5 },
//     //     thickness: 3,
//     //     color: color
//     //   });
//     // }
//     // function drawLeftAlignedUnderlinedText(page, text, x, y, size, font, color = rgb(0, 0, 0), underlineWidth = null) {
//     //   // Draw the text
//     //   page.drawText(text, {
//     //     x: x,
//     //     y: y,
//     //     size: size,
//     //     font: font,
//     //     color: color
//     //   });

//     //   // Calculate width
//     //   const textWidth = font.widthOfTextAtSize(text, size);
//     //   const charWidth = font.widthOfTextAtSize('M', size);

//     //   // If underlineWidth is provided, use it. Otherwise, base it on the text width
//     //   const finalUnderlineWidth = underlineWidth || textWidth + (6 * charWidth / 10) + 10; // fallback to current logic

//     //   page.drawLine({
//     //     start: { x: x - (textWidth / 1.5), y: y - 5 },
//     //     end: { x: x + finalUnderlineWidth, y: y - 5 },
//     //     thickness: 3,
//     //     color: color
//     //   });
//     // }
//     function drawLeftAlignedUnderlinedText(page, text, x, y, size, font, color = rgb(0, 0, 0)) {
//       const textWidth = font.widthOfTextAtSize(text, size);

//       // Fixed underline width
//       const underlineLength = 155;

//       // Decide the underline startX based on layout position
//       let startX = x < 300 ? width - 400 : width - 200;

//       // Center the text within the underline
//       const centeredTextX = startX + (underlineLength / 2) - (textWidth / 2);

//       // Draw centered text
//       page.drawText(text, {
//         x: centeredTextX,
//         y,
//         size,
//         font,
//         color
//       });

//       // Draw fixed underline
//       page.drawLine({
//         start: { x: startX, y: y - 5 },
//         end: { x: startX + underlineLength, y: y - 5 },
//         thickness: 2.5,
//         color
//       });
//     }




//     // Format date function
//     const formatDate = (dateString) => {
//       if (!dateString || dateString === 'In Progress') return 'In Progress';
//       const date = new Date(dateString);
//       const day = date.getDate().toString().padStart(2, '0');
//       const month = date.toLocaleString('en-US', { month: 'short' });
//       const year = date.getFullYear();
//       return `${day} ${month} ${year}`;
//     };

//     // Calculate completion date
//     let completionDate;
//     console.log("latestAwarded.awardedDate:", latestAwarded.awardedDate);

//     if (latestAwarded.expectedFinishingDate) {
//       completionDate = formatDate(latestAwarded.expectedFinishingDate);
//     } else if (latestAwarded.awardedDate) {
//       completionDate = formatDate(latestAwarded.awardedDate);
//     } else {
//       completionDate = 'In Progress';
//     }

//     // Drawing text with labels and proper formatting

//     // Main certification title - positioned above student name
//     if (templateConfig.certifyTitle) {
//       const titleText = '';
//       const titleWidth = montserratRegular.widthOfTextAtSize(titleText, templateConfig.certifyTitle.size);
//       firstPage.drawText(titleText, {
//         x: templateConfig.certifyTitle.x - (titleWidth / 2),
//         y: templateConfig.certifyTitle.y,
//         size: templateConfig.certifyTitle.size,
//         font: montserratRegular,
//         color: rgb(0, 0, 0)
//       });
//     }

//     // Student Name - centered with extended underline
//     if (templateConfig.name) {
//       const formattedName = toCamelCase(`${student.fName} ${student.lName}`);
//       drawCenteredUnderlinedText(
//         firstPage,
//         formattedName,
//         templateConfig.name.x,
//         templateConfig.name.y,
//         templateConfig.name.size,
//         montserratBold
//       );

//       // Name label - positioned below and centered
//       if (templateConfig.nameLabel) {
//         const labelText = 'Name';
//         const labelWidth = montserratRegular.widthOfTextAtSize(labelText, templateConfig.nameLabel.size);
//         firstPage.drawText(labelText, {
//           x: templateConfig.nameLabel.x - (labelWidth / 2),
//           y: templateConfig.nameLabel.y,
//           size: templateConfig.nameLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Guardian Name - centered with extended underline
//     if (templateConfig.guardianName) {
//       const formattedFatherName = toCamelCase(student.guardianName || 'N/A');
//       drawCenteredUnderlinedText(
//         firstPage,
//         formattedFatherName,
//         templateConfig.guardianName.x,
//         templateConfig.guardianName.y,
//         templateConfig.guardianName.size,
//         montserratBold
//       );

//       // Guardian label - centered
//       if (templateConfig.guardianLabel) {
//         const labelText = 'S/o D/o W/o';
//         const labelWidth = montserratRegular.widthOfTextAtSize(labelText, templateConfig.guardianLabel.size);
//         firstPage.drawText(labelText, {
//           x: templateConfig.guardianLabel.x - (labelWidth / 2),
//           y: templateConfig.guardianLabel.y,
//           size: templateConfig.guardianLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Course Name - centered with extended underline
//     if (templateConfig.course) {
//       drawCenteredUnderlinedText(
//         firstPage,
//         student.courseName,
//         templateConfig.course.x,
//         templateConfig.course.y,
//         templateConfig.course.size,
//         montserratBold
//       );

//       // Course label - centered
//       if (templateConfig.courseLabel) {
//         const labelText = 'Course Title';
//         const labelWidth = montserratRegular.widthOfTextAtSize(labelText, templateConfig.courseLabel.size);
//         firstPage.drawText(labelText, {
//           x: templateConfig.courseLabel.x - (labelWidth / 2),
//           y: templateConfig.courseLabel.y,
//           size: templateConfig.courseLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Subjects - centered with extended underline
//     if (templateConfig.subjects) {
//       drawCenteredUnderlinedText(
//         firstPage,
//         subjectsList,
//         templateConfig.subjects.x,
//         templateConfig.subjects.y,
//         templateConfig.subjects.size,
//         montserratBold
//       );

//       // Subjects label - centered
//       if (templateConfig.subjectsLabel) {
//         const labelText = 'Software Covered';
//         const labelWidth = montserratRegular.widthOfTextAtSize(labelText, templateConfig.subjectsLabel.size);
//         firstPage.drawText(labelText, {
//           x: templateConfig.subjectsLabel.x - (labelWidth / 2),
//           y: templateConfig.subjectsLabel.y,
//           size: templateConfig.subjectsLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Course Duration - left aligned with extended underline
//     if (templateConfig.courseDuration) {
//       drawLeftAlignedUnderlinedText(
//         firstPage,
//         courseDuration,
//         templateConfig.courseDuration.x,
//         templateConfig.courseDuration.y,
//         templateConfig.courseDuration.size,
//         montserratBold
//       );

//       // Course duration label
//       if (templateConfig.courseDurationLabel) {
//         firstPage.drawText('Course Duration', {
//           x: templateConfig.courseDurationLabel.x,
//           y: templateConfig.courseDurationLabel.y,
//           size: templateConfig.courseDurationLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Completion Date - left aligned with extended underline
//     if (templateConfig.completionDate) {
//       drawLeftAlignedUnderlinedText(
//         firstPage,
//         completionDate,
//         templateConfig.completionDate.x,
//         templateConfig.completionDate.y,
//         templateConfig.completionDate.size,
//         montserratBold
//       );

//       // Completion date label
//       if (templateConfig.completionDateLabel) {
//         firstPage.drawText('Awarded On', {
//           x: templateConfig.completionDateLabel.x,
//           y: templateConfig.completionDateLabel.y,
//           size: templateConfig.completionDateLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Location - left aligned with extended underline
//     if (templateConfig.location) {
//       drawLeftAlignedUnderlinedText(
//         firstPage,
//         branchInfo.location || branchInfo.branchName,
//         templateConfig.location.x,
//         templateConfig.location.y,
//         templateConfig.location.size,
//         montserratBold
//       );

//       // Location label
//       if (templateConfig.locationLabel) {
//         firstPage.drawText('Training Centre', {
//           x: templateConfig.locationLabel.x,
//           y: templateConfig.locationLabel.y,
//           size: templateConfig.locationLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Grade - left aligned with extended underline
//     if (templateConfig.grade) {
//       drawLeftAlignedUnderlinedText(
//         firstPage,
//         student.grade || 'A',
//         templateConfig.grade.x,
//         templateConfig.grade.y,
//         templateConfig.grade.size,
//         montserratBold
//       );

//       // Grade label
//       if (templateConfig.gradeLabel) {
//         firstPage.drawText('Grade', {
//           x: templateConfig.gradeLabel.x,
//           y: templateConfig.gradeLabel.y,
//           size: templateConfig.gradeLabel.size,
//           font: montserratRegular,
//           color: rgb(0, 0, 0)
//         });
//       }
//     }

//     // Certificate ID - positioned at bottom right
//     if (templateConfig.certificateId) {
//       firstPage.drawText(`CC NO: ${student.regid}`, {
//         x: templateConfig.certificateId.x,
//         y: templateConfig.certificateId.y,
//         size: templateConfig.certificateId.size,
//         font: montserratBold,
//         color: rgb(0,0,0) // Lighter gray color for certificate ID
//       });
//     }

//     // Save modified PDF
//     const pdfBytes = await pdfDoc.save();

//     // Set response headers
//     res.setHeader('Content-Type', 'application/pdf');
//     res.setHeader('Content-Disposition', `attachment; filename=Certificate_${regid}.pdf`);
//     res.send(Buffer.from(pdfBytes));

//   } catch (error) {
//     console.error('Error generating certificate:', error);
//     res.status(500).json({ success: false, message: 'Server Error' });
//   }
// });
app.get('/api/certificate/download/:regid', async (req, res) => {
  try {
    const { regid } = req.params;

    // Find the student
    const student = await Registration.findOne({ regid }).lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Find batch - Fixed the query structure
    const batches = await Batch.find({ assignedStudents: student._id }).lean();
    console.log("batches:", batches);
    if (!batches || batches.length === 0) {
      return res.status(400).json({ success: false, message: 'Student is not assigned to any batch' });
    }

    // Get the course information
    const course = await Course.findOne({ CourseName: student.courseName }).lean();
    if (!course) {
      console.log(`Course not found with name: ${student.courseName}, using default course information`);
    }

    // Get the branch information - using branchId instead of branchCode
    const branch = await Branch.findOne({ branchId: student.branchId }).lean();
    console.log("branch", branch);
    if (!branch) {
      console.log(`Branch not found with code: ${student.branchId}, using default branch information`);
      const defaultBranch = {
        branchName: student.branchName || 'JBK Academy',
        location: 'Ameerpet'
      };
      var branchInfo = defaultBranch;
    } else {
      var branchInfo = branch;
    }

    // Check payment status
    let paymentCompleted = student.feeType === 'Single' && student.singlePaymentStatus === 'Paid' ||
      student.feeType === 'Installment' && student.paymentsPlan?.[student.installmentCount - 1]?.status === 'Paid';
    if (!paymentCompleted) {
      return res.status(400).json({ success: false, message: 'Payment not completed' });
    }

    // Find the latest awarded batch - Fixed the reduce logic
    const latestAwarded = batches.reduce((latest, current) => {
      if (!latest.awardedDate && !current.awardedDate) {
        return latest; // Return first batch if neither has awardedDate
      }

      if (!latest.awardedDate) return current;
      if (!current.awardedDate) return latest;
      return new Date(current.awardedDate) > new Date(latest.awardedDate) ? current : latest;
    });

    console.log('latestAwarded batch:', latestAwarded);

    // Calculate course duration - Fixed duration calculation
    let courseDuration = 'N/A';

    if (latestAwarded?.duration) {
      if (typeof latestAwarded.duration === 'object') {
        // If duration is stored as an object with months/days
        const { months = 0, days = 0 } = latestAwarded.duration;
        const monthsText = months > 0 ? `${months} month${months > 1 ? 's' : ''}` : '';
        const daysText = days > 0 ? `${days} day${days > 1 ? 's' : ''}` : '';

        if (monthsText && daysText) {
          courseDuration = `${monthsText} and ${daysText}`;
        } else {
          courseDuration = monthsText || daysText || 'N/A';
        }
      } else if (typeof latestAwarded.duration === 'number') {
        // If duration is stored as number (assuming months)
        const months = latestAwarded.duration;
        courseDuration = `${months} month${months > 1 ? 's' : ''}`;
      } else if (typeof latestAwarded.duration === 'string') {
        // If duration is already a formatted string
        courseDuration = latestAwarded.duration;
      }
    } else if (latestAwarded?.startDate && latestAwarded?.expectedFinishingDate) {
      // Calculate duration from start and end dates if duration field is not available
      const startDate = new Date(latestAwarded.startDate);
      const endDate = new Date(latestAwarded.expectedFinishingDate);
      const diffTime = Math.abs(endDate - startDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const diffMonths = Math.floor(diffDays / 30);
      const remainingDays = diffDays % 30;

      if (diffMonths > 0 && remainingDays > 0) {
        courseDuration = `${diffMonths} month${diffMonths > 1 ? 's' : ''} and ${remainingDays} day${remainingDays > 1 ? 's' : ''}`;
      } else if (diffMonths > 0) {
        courseDuration = `${diffMonths} month${diffMonths > 1 ? 's' : ''}`;
      } else {
        courseDuration = `${diffDays} day${diffDays > 1 ? 's' : ''}`;
      }
    }

    console.log('Calculated courseDuration:', course);

    let templateFileName;
    let templateConfig;
    const branchName = branchInfo.branchName;
    courseDuration = (String(course.duration.value)+" "+course.duration.unit)
    // Updated template configurations with proper coordinates for each template
    const templateConfigs = {
      'JBK-Academy-Ameerpet.pdf': {
        // Main title "This is to certify that" - positioned above the name
        certifyTitle: { x: 100, y: 350, size: 16 },

        // Student name - centered under "This is to certify that"
        name: { x: 360, y: 508, size: 18 },
        nameLabel: { x: 360, y: 488, size: 14 },

        // Guardian/Father name - positioned below student name
        guardianName: { x: 360, y: 450, size: 16 },
        guardianLabel: { x: 360, y: 430, size: 14 },

        // Course name - positioned below guardian name
        course: { x: 360, y: 390, size: 16 },
        courseLabel: { x: 360, y: 368, size: 14 },

        // Subjects/Software covered - positioned below course
        subjects: { x: 360, y: 330, size: 16 },
        subjectsLabel: { x: 360, y: 308, size: 14 },

        // Course duration - left side bottom section
        courseDuration: { x: 250, y: 250, size: 16 },
        courseDurationLabel: { x: 230, y: 230, size: 14 },

        // Completion/Awarded date - right side bottom section
        completionDate: { x: 420, y: 250, size: 16 },
        completionDateLabel: { x: 440, y: 230, size: 14 },

        // Training centre/location - left side lower
        location: { x: 250, y: 180, size: 16 },
        locationLabel: { x: 227, y: 160, size: 14 },

        // Grade - right side lower
        grade: { x: 420, y: 180, size: 18 },
        gradeLabel: { x: 455, y: 160, size: 14 },

        // Certificate ID - bottom right corner
        certificateId: { x: 420, y: 765, size: 15 }
      },
      'Onclick-Digital-Marketing.pdf': {
        certifyTitle: { x: 180, y: 400, size: 18 },
        name: { x: 315, y: 350, size: 30 },
        nameLabel: { x: 380, y: 325, size: 14 },
        courseDuration: { x: 200, y: 250, size: 18 },
        courseDurationLabel: { x: 210, y: 225, size: 14 },
        completionDate: { x: 490, y: 250, size: 18 },
        completionDateLabel: { x: 500, y: 225, size: 14 },
        certificateId: { x: 650, y: 120, size: 14 }
      },
      'Raster-FxStudios-Certification.pdf': {
        certifyTitle: { x: 180, y: 450, size: 18 },
        name: { x: 330, y: 398, size: 26 },
        nameLabel: { x: 380, y: 375, size: 14 },
        guardianName: { x: 520, y: 398, size: 18 },
        guardianLabel: { x: 540, y: 375, size: 14 },
        course: { x: 330, y: 318, size: 20 },
        courseLabel: { x: 380, y: 295, size: 14 },
        subjects: { x: 520, y: 318, size: 18 },
        subjectsLabel: { x: 540, y: 295, size: 14 },
        courseDuration: { x: 340, y: 260, size: 18 },
        courseDurationLabel: { x: 350, y: 235, size: 14 },
        completionDate: { x: 570, y: 260, size: 18 },
        completionDateLabel: { x: 580, y: 235, size: 14 },
        location: { x: 310, y: 193, size: 18 },
        locationLabel: { x: 320, y: 170, size: 14 },
        grade: { x: 590, y: 195, size: 18 },
        gradeLabel: { x: 600, y: 170, size: 14 },
        certificateId: { x: 469, y: 120, size: 14 }
      }
    };

    if (branchName.includes('JBK') || branchName.includes('Academy')) {
      templateFileName = 'JBK-Academy-Ameerpet.pdf';
    } else if (branchName.includes('Onclick') || branchName.includes('Digital Marketing')) {
      templateFileName = 'Onclick-Digital-Marketing.pdf';
    } else if (branchName.includes('Raster') || branchName.includes('FX Studios')) {
      templateFileName = 'Raster-FxStudios-Certification.pdf';
    } else {
      // Default template if branch name doesn't match
      templateFileName = 'JBK-Academy-Ameerpet.pdf';
    }

    // Get the configuration for the selected template
    templateConfig = templateConfigs[templateFileName];

    // Load the appropriate PDF template
    const pdfPath = path.join(__dirname, `./certificate/${templateFileName}`);
    const existingPdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const [page] = pdfDoc.getPages();
    const { width, height } = page.getSize();
    // Embed fonts
    const fontPath = path.join(__dirname, './fonts/Montserrat-Bold.ttf');
    const fontRegularPath = path.join(__dirname, './fonts/Montserrat-Regular.ttf');

    let montserratBold, montserratRegular;
    try {
      const boldFontBytes = fs.readFileSync(fontPath);
      const regularFontBytes = fs.readFileSync(fontRegularPath);

      montserratBold = await pdfDoc.embedFont(boldFontBytes);
      montserratRegular = await pdfDoc.embedFont(regularFontBytes);
    } catch (error) {
      console.log('Could not load custom fonts, using standard font:', error.message);
      montserratBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      montserratRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }

    const pages = pdfDoc.getPages();
    const firstPage = pages[0];

    // FIXED: Get subject list from selectedSubjects field properly
    let subjectsList = 'N/A';
    try {
      if (student.selectedSubjects && student.selectedSubjects.length > 0) {
        // Fetch the actual subject documents using the ObjectIds
        const subjects = await Subject.find({
          _id: { $in: student.selectedSubjects }
        }).lean();

        if (subjects && subjects.length > 0) {
          // Extract SubjectName from each subject document
          subjectsList = subjects.map(subject => subject.SubjectName).join(', ');
          console.log('Retrieved subjects from selectedSubjects:', subjectsList);
        } else {
          console.log('No subjects found for selectedSubjects ObjectIds');
          // Fallback to course subjects if selectedSubjects lookup fails
          if (course && course.subjects && course.subjects.length > 0) {
            subjectsList = course.subjects.map(subject => subject.subjectName).join(', ');
          } else {
            subjectsList = student.courseSubject || student.courseName || 'N/A';
          }
        }
      } else if (course && course.subjects && course.subjects.length > 0) {
        // Fallback to course subjects if no selectedSubjects
        subjectsList = course.subjects.map(subject => subject.subjectName).join(', ');
        console.log('Retrieved subjects from course schema:', subjectsList);
      } else {
        // Final fallback to student fields
        subjectsList = student.courseSubject || student.courseName || 'N/A';
        console.log('Used fallback subjects:', subjectsList);
      }
    } catch (error) {
      console.error('Error fetching subjects:', error);
      // Use fallback in case of error
      subjectsList = student.courseSubject || student.courseName || 'N/A';
    }

    console.log('Final subjects list for certificate:', subjectsList);

    // Function to convert a string to camel case
    function toCamelCase(str) {
      if (!str) return '';
      return str.split(' ')
        .map(word => {
          if (word.length <= 2) {
            return word.toUpperCase();
          } else {
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
          }
        })
        .join(' ');
    }

    // Function to draw centered underlined text with extended underline
    function drawCenteredUnderlinedText(page, text, x, y, size, font, color = rgb(0, 0, 0)) {
      // Calculate text width for centering
      const textWidth = font.widthOfTextAtSize(text, size);
      const centeredX = x - (textWidth / 2);

      // Draw the text
      page.drawText(text, {
        x: centeredX,
        y: y,
        size: size,
        font: font,
        color: color
      });


      page.drawLine({
        start: { x: (width - 400), y: y - 5 },
        end: { x: (width - 50), y: y - 5 },
        thickness: 2.5,
        color: color
      });
    }

    // Function to draw left-aligned underlined text with extended underline
    // function drawLeftAlignedUnderlinedText(page, text, x, y, size, font, color = rgb(0, 0, 0)) {
    //   // Draw the text
    //   page.drawText(text, {
    //     x: x,
    //     y: y,
    //     size: size,
    //     font: font,
    //     color: color
    //   });

    //   // Calculate text width for underline
    //   const textWidth = font.widthOfTextAtSize(text, size);

    //   // Extended underline - increased by 4 more character spaces on each side
    //   const charWidth = font.widthOfTextAtSize('M', size);
    //   const underlineExtension = (2 + 4) * charWidth / 10; // Extended from 2 to 6 characters worth
    //   page.drawLine({
    //     start: { x: x - underlineExtension, y: y - 5 },
    //     end: { x: x + textWidth + underlineExtension, y: y - 5 },
    //     thickness: 3,
    //     color: color
    //   });
    // }
    // function drawLeftAlignedUnderlinedText(page, text, x, y, size, font, color = rgb(0, 0, 0), underlineWidth = null) {
    //   // Draw the text
    //   page.drawText(text, {
    //     x: x,
    //     y: y,
    //     size: size,
    //     font: font,
    //     color: color
    //   });

    //   // Calculate width
    //   const textWidth = font.widthOfTextAtSize(text, size);
    //   const charWidth = font.widthOfTextAtSize('M', size);

    //   // If underlineWidth is provided, use it. Otherwise, base it on the text width
    //   const finalUnderlineWidth = underlineWidth || textWidth + (6 * charWidth / 10) + 10; // fallback to current logic

    //   page.drawLine({
    //     start: { x: x - (textWidth / 1.5), y: y - 5 },
    //     end: { x: x + finalUnderlineWidth, y: y - 5 },
    //     thickness: 3,
    //     color: color
    //   });
    // }
    function drawLeftAlignedUnderlinedText(page, text, x, y, size, font, color = rgb(0, 0, 0)) {
      const textWidth = font.widthOfTextAtSize(text, size);

      // Fixed underline width
      const underlineLength = 155;

      // Decide the underline startX based on layout position
      let startX = x < 300 ? width - 400 : width - 200;

      // Center the text within the underline
      const centeredTextX = startX + (underlineLength / 2) - (textWidth / 2);

      // Draw centered text
      page.drawText(text, {
        x: centeredTextX,
        y,
        size,
        font,
        color
      });

      // Draw fixed underline
      page.drawLine({
        start: { x: startX, y: y - 5 },
        end: { x: startX + underlineLength, y: y - 5 },
        thickness: 2.5,
        color
      });
    }




    // Format date function
    const formatDate = (dateString) => {
      if (!dateString || dateString === 'In Progress') return 'In Progress';
      const date = new Date(dateString);
      const day = date.getDate().toString().padStart(2, '0');
      const month = date.toLocaleString('en-US', { month: 'short' });
      const year = date.getFullYear();
      return `${day} ${month} ${year}`;
    };

    // Calculate completion date
    let completionDate;
    console.log("latestAwarded.awardedDate:", latestAwarded.awardedDate);

    if (latestAwarded.expectedFinishingDate) {
      completionDate = formatDate(latestAwarded.expectedFinishingDate);
    } else if (latestAwarded.awardedDate) {
      completionDate = formatDate(latestAwarded.awardedDate);
    } else {
      completionDate = 'In Progress';
    }

    // Drawing text with labels and proper formatting

    // Main certification title - positioned above student name
    if (templateConfig.certifyTitle) {
      const titleText = '';
      const titleWidth = montserratRegular.widthOfTextAtSize(titleText, templateConfig.certifyTitle.size);
      firstPage.drawText(titleText, {
        x: templateConfig.certifyTitle.x - (titleWidth / 2),
        y: templateConfig.certifyTitle.y,
        size: templateConfig.certifyTitle.size,
        font: montserratRegular,
        color: rgb(0, 0, 0)
      });
    }

    // Student Name - centered with extended underline
    if (templateConfig.name) {
      const formattedName = toCamelCase(`${student.fName} ${student.lName}`);
      drawCenteredUnderlinedText(
        firstPage,
        formattedName,
        templateConfig.name.x,
        templateConfig.name.y,
        templateConfig.name.size,
        montserratBold
      );

      // Name label - positioned below and centered
      if (templateConfig.nameLabel) {
        const labelText = 'Name';
        const labelWidth = montserratRegular.widthOfTextAtSize(labelText, templateConfig.nameLabel.size);
        firstPage.drawText(labelText, {
          x: templateConfig.nameLabel.x - (labelWidth / 2),
          y: templateConfig.nameLabel.y,
          size: templateConfig.nameLabel.size,
          font: montserratRegular,
          color: rgb(0, 0, 0)
        });
      }
    }

    // Guardian Name - centered with extended underline
    if (templateConfig.guardianName) {
      const formattedFatherName = toCamelCase(student.guardianName || 'N/A');
      drawCenteredUnderlinedText(
        firstPage,
        formattedFatherName,
        templateConfig.guardianName.x,
        templateConfig.guardianName.y,
        templateConfig.guardianName.size,
        montserratBold
      );

      // Guardian label - centered
      if (templateConfig.guardianLabel) {
        const labelText = 'S/o D/o W/o';
        const labelWidth = montserratRegular.widthOfTextAtSize(labelText, templateConfig.guardianLabel.size);
        firstPage.drawText(labelText, {
          x: templateConfig.guardianLabel.x - (labelWidth / 2),
          y: templateConfig.guardianLabel.y,
          size: templateConfig.guardianLabel.size,
          font: montserratRegular,
          color: rgb(0, 0, 0)
        });
      }
    }

    // Course Name - centered with extended underline
    if (templateConfig.course) {
      drawCenteredUnderlinedText(
        firstPage,
        student.courseName,
        templateConfig.course.x,
        templateConfig.course.y,
        templateConfig.course.size,
        montserratBold
      );

      // Course label - centered
      if (templateConfig.courseLabel) {
        const labelText = 'Course Title';
        const labelWidth = montserratRegular.widthOfTextAtSize(labelText, templateConfig.courseLabel.size);
        firstPage.drawText(labelText, {
          x: templateConfig.courseLabel.x - (labelWidth / 2),
          y: templateConfig.courseLabel.y,
          size: templateConfig.courseLabel.size,
          font: montserratRegular,
          color: rgb(0, 0, 0)
        });
      }
    }

    // Subjects - centered with extended underline
    if (templateConfig.subjects) {
      drawCenteredUnderlinedText(
        firstPage,
        subjectsList,
        templateConfig.subjects.x,
        templateConfig.subjects.y,
        templateConfig.subjects.size,
        montserratBold
      );

      // Subjects label - centered
      if (templateConfig.subjectsLabel) {
        const labelText = 'Software Covered';
        const labelWidth = montserratRegular.widthOfTextAtSize(labelText, templateConfig.subjectsLabel.size);
        firstPage.drawText(labelText, {
          x: templateConfig.subjectsLabel.x - (labelWidth / 2),
          y: templateConfig.subjectsLabel.y,
          size: templateConfig.subjectsLabel.size,
          font: montserratRegular,
          color: rgb(0, 0, 0)
        });
      }
    }

    // Course Duration - left aligned with extended underline
    if (templateConfig.courseDuration) {
      drawLeftAlignedUnderlinedText(
        firstPage,
        courseDuration,
        templateConfig.courseDuration.x,
        templateConfig.courseDuration.y,
        templateConfig.courseDuration.size,
        montserratBold
      );

      // Course duration label
      if (templateConfig.courseDurationLabel) {
        firstPage.drawText('Course Duration', {
          x: templateConfig.courseDurationLabel.x,
          y: templateConfig.courseDurationLabel.y,
          size: templateConfig.courseDurationLabel.size,
          font: montserratRegular,
          color: rgb(0, 0, 0)
        });
      }
    }

    // Completion Date - left aligned with extended underline
    if (templateConfig.completionDate) {
      drawLeftAlignedUnderlinedText(
        firstPage,
        completionDate,
        templateConfig.completionDate.x,
        templateConfig.completionDate.y,
        templateConfig.completionDate.size,
        montserratBold
      );

      // Completion date label
      if (templateConfig.completionDateLabel) {
        firstPage.drawText('Awarded On', {
          x: templateConfig.completionDateLabel.x,
          y: templateConfig.completionDateLabel.y,
          size: templateConfig.completionDateLabel.size,
          font: montserratRegular,
          color: rgb(0, 0, 0)
        });
      }
    }

    // Location - left aligned with extended underline
    if (templateConfig.location) {
      drawLeftAlignedUnderlinedText(
        firstPage,
        branchInfo.location || branchInfo.branchName,
        templateConfig.location.x,
        templateConfig.location.y,
        templateConfig.location.size,
        montserratBold
      );

      // Location label
      if (templateConfig.locationLabel) {
        firstPage.drawText('Training Centre', {
          x: templateConfig.locationLabel.x,
          y: templateConfig.locationLabel.y,
          size: templateConfig.locationLabel.size,
          font: montserratRegular,
          color: rgb(0, 0, 0)
        });
      }
    }

    // Grade - left aligned with extended underline
    if (templateConfig.grade) {
      drawLeftAlignedUnderlinedText(
        firstPage,
        student.grade || 'A',
        templateConfig.grade.x,
        templateConfig.grade.y,
        templateConfig.grade.size,
        montserratBold
      );

      // Grade label
      if (templateConfig.gradeLabel) {
        firstPage.drawText('Grade', {
          x: templateConfig.gradeLabel.x,
          y: templateConfig.gradeLabel.y,
          size: templateConfig.gradeLabel.size,
          font: montserratRegular,
          color: rgb(0, 0, 0)
        });
      }
    }

    // Certificate ID - positioned at bottom right
    if (templateConfig.certificateId) {
      firstPage.drawText(`CC NO: ${student.regid}`, {
        x: templateConfig.certificateId.x,
        y: templateConfig.certificateId.y,
        size: templateConfig.certificateId.size,
        font: montserratBold,
        color: rgb(0,0,0) // Lighter gray color for certificate ID
      });
    }

    // Save modified PDF
    const pdfBytes = await pdfDoc.save();

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Certificate_${regid}.pdf`);
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('Error generating certificate:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

app.post("/api/google-form-response", async (req, res) => {
  try {
    const enquiry = new Enquiry(req.body);
    await enquiry.save();
    res.status(201).json({ message: "Enquiry data saved successfully" });
  } catch (error) {
    res.status(500).json({ error: "Error saving Enquiry data" });
  }
});

// app.post('/api/JobRequirement-form', async (req, res) => {
//   try {
//     const newJob = new JobRequirement(req.body);
//     await newJob.save();
//     res.status(201).json({ message: 'Form submitted successfully', job: newJob });
//   } catch (error) {
//     console.error('Error submitting form:', error);
//     res.status(500).json({ message: 'Error submitting form', error });
//   }
// });


app.post('/api/JobRequirement-form', async (req, res) => {
  try {
    const { branchId, ...otherData } = req.body;
    
    // Get count of existing jobs for this branch
    const jobCount = await JobRequirement.countDocuments({ branchId: branchId });
    
    // Generate jobId: branchId + sequential number (padded)
    const jobId = `${branchId}-${String(jobCount + 1).padStart(3, '0')}`;
    
    const newJob = new JobRequirement({
      jobId,
      branchId,
      ...otherData
    });
    
    await newJob.save();
    res.status(201).json({ 
      message: 'Form submitted successfully', 
      job: newJob,
      jobId: jobId 
    });
  } catch (error) {
    console.error('Error submitting form:', error);
    res.status(500).json({ message: 'Error submitting form', error });
  }
});
app.get('/api/generate-jobId/:branchId', async (req, res) => {
  try {
    const { branchId } = req.params;
    const jobCount = await JobRequirement.countDocuments({ branchId: branchId });
    const jobId = `${branchId}-${String(jobCount + 1).padStart(3, '0')}`;
    
    res.json({ jobId });
  } catch (error) {
    console.error('Error generating jobId:', error);
    res.status(500).json({ message: 'Error generating jobId', error });
  }
});
app.get('/api/listjobs', async (req, res) => {
  try {
    const jobs = await JobRequirement.find();
    res.status(200).json(jobs);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching jobs', error });
  }
});

app.put('/api/closejob/:jobId', async (req, res) => {
  const { jobId } = req.params;

  try {
    const updatedJob = await JobRequirement.findByIdAndUpdate(
      jobId,
      { status: 'Expired' },
      { new: true }
    );

    if (!updatedJob) {
      return res.status(404).json({ message: 'Job not found' });
    }

    res.status(200).json({ message: 'Job closed successfully', job: updatedJob });
  } catch (error) {
    res.status(500).json({ message: 'Error closing job', error });
  }
});

// GET a single job by ID
app.get('/api/getjob/:jobId', async (req, res) => {
  const { jobId } = req.params;

  try {
    const job = await JobRequirement.findById(jobId);
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }
    res.status(200).json(job);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching job', error });
  }
});

// PUT update job by ID
app.put('/api/updatejob/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const updateData = req.body;

  try {
    const updatedJob = await JobRequirement.findByIdAndUpdate(
      jobId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedJob) {
      return res.status(404).json({ message: 'Job not found' });
    }

    res.status(200).json({ message: 'Job updated successfully', job: updatedJob });
  } catch (error) {
    res.status(500).json({ message: 'Error updating job', error });
  }
});

app.delete('/api/deletejob/:jobId', async (req, res) => {
  const { jobId } = req.params;

  try {
    const deletedJob = await JobRequirement.findByIdAndDelete(jobId);

    if (!deletedJob) {
      return res.status(404).json({ message: 'Job not found' });
    }

    res.status(200).json({ message: 'Job deleted successfully', job: deletedJob });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting job', error });
  }
});

app.post("/api/apply-job", resumeupload.fields([
  { name: "resume", maxCount: 1 },
  { name: "coverLetter", maxCount: 1 },
  {name:"certificate", maxCount: 1}
]), async (req, res) => {
  try {
    const files = req.files;

    if (!files || !files.resume) {
      return res.status(400).json({ message: "Resume file is required" });
    }

    const newApplication = new jobApplication({
      ...req.body,
      resume: files.resume[0].filename,
      coverLetter: files.coverLetter ? files.coverLetter[0].filename : null,
      certificate: files.certificate ? files.certificate[0].filename : null
    });

    await newApplication.save();
    res.status(201).json({ message: "Application submitted successfully", application: newApplication });
  } catch (error) {
    res.status(500).json({ message: "Error submitting application", error });
  }
});


app.get("/api/applications", async (req, res) => {
  try {
    const { jobId, name, experience } = req.query;

    // Build query dynamically
    const query = {};

    if (jobId) {
      query.jobId = jobId;
    }

    if (name) {
      query.name = { $regex: name, $options: "i" }; // case-insensitive name search
    }

    if (experience) {
      query.experience = experience;
    }

    const applications = await jobApplication.find(query).sort({ createdAt: -1 });
    res.status(200).json(applications);
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).json({ message: "Error fetching applications", error });
  }
});

app.get("/api/downloadapplications/:jobId", async (req, res) => {
  const { jobId } = req.params;

  try {
    const applications = await jobApplication.find({ jobId });
    console.log("applications",applications)
    if (applications.length===0) {
      return res.status(404).json({ message: "No applications found for this job." });
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=applications_${jobId}.zip`);

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", err => {
      console.error("Archiver error:", err);
      res.status(500).send("Error creating ZIP file");
    });

    archive.pipe(res);

    const baseFolder = path.join(__dirname, "./resumes"); // Assuming both files are here

    for (let i = 0; i < applications.length; i++) {
      const app = applications[i];
      const safeName = `app.name?.replace(/\s+/g, "_") || applicant_${i + 1}`;

      // Add resume if available
      if (app.resume) {
        const resumePath = path.join(baseFolder, app.resume);
        if (fs.existsSync(resumePath)) {
          const resumeExt = path.extname(resumePath);
          archive.file(`resumePath, { name: ${safeName}_Resume${resumeExt} }`);
        }
      }

      // Add cover letter if available
      if (app.coverLetter) {
        const coverLetterPath = path.join(baseFolder, app.coverLetter);
        if (fs.existsSync(coverLetterPath)) {
          const coverExt = path.extname(coverLetterPath);
          archive.file(`coverLetterPath, { name: ${safeName}_CoverLetter${coverExt} }`);
        }
      }
    }

    archive.finalize();
  } catch (error) {
    console.error("Error downloading applications:", error);
    res.status(500).json({ message: "Server error" });
  }
});


app.get("/download-resume/:filename", (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, "resumes", filename);

  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      return res.status(404).send("Resume not found");
    }

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    res.download(filePath);
  });
});

app.get("/api/batches", async (req, res) => {
  try {
    const batches = await Batch.find().populate("assignedStudents", "firstName lastName").populate('assignedStudents');
    res.json(batches);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching batches", error: err.message });
  }
});

// ✅ Fetch Attendance by Batch, Month, and Year (Improved Query)
// app.get("/api/attendance/:batchId/:month/:year", async (req, res) => {
//   console.log("Received Params:", req.params); // Debugging log
//   const { batchId, month, year } = req.params;
//   try {
//     // Format month correctly (ensure it has two digits)
//     const monthStr = String(month).padStart(2, "0");

//     const attendanceRecords = await StudentAttendance.find({
//       batchId,
//       date: { $regex: `^${year}-${monthStr}-` } // ✅ Correct regex for month-wise filtering
//     }).populate("students.studentId", "firstName lastName");
//     console.log("Attendance Records:", attendanceRecords); // Debugging log
//     res.json(attendanceRecords);
//   } catch (err) {
//     res.status(500).json({ msg: "Error fetching attendance", error: err.message });
//   }
// });


app.get("/api/attendance/:batchId/:month/:year", async (req, res) => {

  console.log("Received Params:", req.params);

  const { batchId, month, year } = req.params;

  try {

    // CREATE DATE RANGE
    const startDate = new Date(year, month - 1, 1);

    const endDate = new Date(year, month, 0);
    endDate.setHours(23, 59, 59, 999);

    console.log("START DATE:", startDate);
    console.log("END DATE:", endDate);

    // FETCH ATTENDANCE
    const attendanceRecords = await StudentAttendance.find({
      batchId: batchId,
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    }).populate(
      "students.studentId",
      "firstName lastName"
    );

    console.log(
      "Attendance Records Found:",
      attendanceRecords.length
    );

    console.log("Attendance Records:", attendanceRecords);

    res.json(attendanceRecords);

  } catch (err) {

    console.error("Attendance Fetch Error:", err);

    res.status(500).json({
      msg: "Error fetching attendance",
      error: err.message,
    });

  }

});
app.post("/api/student-attendance", async (req, res) => {
  const { batchId, date, students } = req.body;
  console.log("Received Data:", { batchId, date, students });

  try {
    let attendance = await StudentAttendance.findOne({ batchId, date });

    if (attendance) {
      students.forEach((newEntry) => {
        const existingStudent = attendance.students.find(s => s.studentId.toString() === newEntry.studentId);
        if (existingStudent) {
          existingStudent.status = newEntry.status; // ✅ Update status
        } else {
          attendance.students.push(newEntry); // ✅ Add new student entry
        }
      });
    } else {
      attendance = new StudentAttendance({ batchId, date, students });
    }

    await attendance.save();
    res.json({ msg: "Attendance saved successfully" });
  } catch (err) {
    console.error("Error saving attendance:", err);
    res.status(500).json({ msg: "Error saving attendance", error: err.message });
  }
});

app.get('/api/student-attendance', async (req, res) => {
  try {
    const { userId, batchId } = req.query;
    if (!userId || !batchId) {
      return res.status(400).json({ message: 'User ID and Batch ID are required' });
    }

    // Find attendance records for this batch where this student is present // Optional: Add validation 
    if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(batchId)) {
      return res.status(400).json({ message: 'Invalid user ID or batch ID' });
    }
    // Then pass them directly 
    const attendanceRecords = await StudentAttendance.find({ batchId: batchId, 'students.studentId': userId }).sort({ date: -1 });
    // Format the response to include only the student's status for each date        
    const formattedAttendance = attendanceRecords.map(record => {

      const studentRecord = record.students.find(student => student.studentId.toString() === userId);
      return {
        date: record.date,
        status: studentRecord ? studentRecord.status : null
      };
    });
    res.json(formattedAttendance);
  } catch (error) {
    console.error('Error fetching student attendance:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
})

app.get("/api/summary/:batchId/:month/:year", async (req, res) => {
  try {
    const { batchId, month, year } = req.params;
    const selectedMonth = parseInt(month);
    const selectedYear = parseInt(year);

    // Fetch attendance records for the given month and batch
    const attendanceRecords = await Attendance.find({
      batchId,
      date: {
        $gte: new Date(selectedYear, selectedMonth - 1, 1),
        $lt: new Date(selectedYear, selectedMonth, 1),
      },
    });

    if (!attendanceRecords.length) {
      return res.json({});
    }

    // Initialize summary object
    let attendanceSummary = {};

    attendanceRecords.forEach((record) => {
      record.attendance.forEach((entry) => {
        const studentId = entry.studentId.toString();

        if (!attendanceSummary[studentId]) {
          attendanceSummary[studentId] = { fullDay: 0, halfDay: 0, absent: 0 };
        }

        if (entry.status === "full-day") {
          attendanceSummary[studentId].fullDay += 1;
        } else if (entry.status === "half-day") {
          attendanceSummary[studentId].halfDay += 1;
        } else {
          attendanceSummary[studentId].absent += 1;
        }
      });
    });

    console.log("Attendance Summary API Response:", attendanceSummary); // Debugging log

    res.json(attendanceSummary);
  } catch (error) {
    console.error("Error fetching attendance summary:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


app.get("/api/attendance/summary/:batchId/:month/:year", async (req, res) => {
  try {
    const { batchId, month, year } = req.params;
    const monthInt = parseInt(month);
    const yearInt = parseInt(year);

    // Fetch attendance records for the given batch & date range
    const attendanceRecords = await Attendance.find({
      batchId: batchId,
      date: {
        $gte: new Date(yearInt, monthInt - 1, 1),
        $lt: new Date(yearInt, monthInt, 1),
      },
    });

    console.log("Fetched Attendance Records:", attendanceRecords); // Debugging

    // Initialize summary object
    const summary = {};

    // Loop through attendance records
    attendanceRecords.forEach((record) => {
      record.students.forEach((student) => {
        const studentId = student.studentId.toString();

        if (!summary[studentId]) {
          summary[studentId] = { present: 0, absent: 0 };
        }

        console.log(`Student ${studentId} - Status: ${student.status}`); // Debugging

        if (student.status === "full-day") {
          summary[studentId].present++;
        } else {
          summary[studentId].absent++;
        }
      });
    });

    console.log("Final Attendance Summary:", summary); // Debugging
    res.json(summary);
  } catch (error) {
    console.error("Error fetching attendance summary:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


app.get('/api/std/batches', async (req, res) => {
  try {
    // Populate the faculty references from the Faculty schema
    const batches = await Batch.find()
      .populate({
        path: 'subject.faculty',
        model: 'Faculty', // Make sure this matches your Faculty model name
        select: 'firstName lastName name' // Select the fields you want
      })


    console.log('batches found:', batches.length);
    res.json(batches);
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

// app.post("/api/batches", async (req, res) => {
//   try {
//     const batchData = req.body;

//     batchData.batchId = batchData.batchId.trim().toUpperCase();
//     batchData.MasterBranchID = batchData.selectedMasterBranch;
//     console.log("Batch Data Received:", batchData);
//     // Check if batch ID already exists
//     const existingBatch = await Batch.findOne({ batchId: batchData.batchId });
//     if (existingBatch) {
//       return res.status(400).json({ error: "Batch ID already exists" });
//     }

//     // Ensure hoursPerDay is number for each subject (just in case it's string)
//     batchData.subject = batchData.subject.map(sub => ({
//       ...sub,
//       hoursPerDay: parseFloat(sub.hoursPerDay)
//     }));

//     const batch = new Batch(batchData);
//     await batch.save();

//     res.status(201).json(batch);
//   } catch (error) {
//     console.error("Error creating batch:", error);
//     res.status(500).json({ error: "Failed to create batch" });
//   }
// })
app.post("/api/batches", async (req, res) => {
  try {
    const batchData = req.body;
console.log("Received Batch Data:", batchData);
    batchData.batchId = batchData.batchId.trim().toUpperCase();
    batchData.MasterBranchID = batchData.selectedMasterBranch;
    console.log("Batch Data Received:", batchData);
    
    // Check if batch ID already exists
    const existingBatch = await Batch.findOne({ batchId: batchData.batchId });
    if (existingBatch) {
      return res.status(400).json({ error: "Batch ID already exists" });
    }

    // Format the subject data for database storage
    batchData.subject = batchData.subject.map(sub => {
      // Ensure hoursPerDay is a number for each schedule entry
      const schedule = Array.isArray(sub.schedule) ? sub.schedule.map(s => ({
        ...s,
        hoursPerDay: parseFloat(s.hoursPerDay)
      })) : [];

      return {
        subject: sub.subject,
        faculty: sub.faculty,
        schedule
      };
    });

    const batch = new Batch(batchData);
    await batch.save();

    res.status(201).json(batch);
  } catch (error) {
    console.error("Error creating batch:", error);
    res.status(500).json({ error: "Failed to create batch" });
  }
});
app.post('/api/send-reset-code', async (req, res) => {
  const { email } = req.body;
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

  let user = await Faculty.findOne({ email });
  let userType = 'faculty';
  if (!user) {
    user = await Registration.findOne({ email });
    userType = 'register';
  }

  if (!user) return res.status(404).json({ message: 'User not found' });

  user.resetCode = code;
  user.resetCodeExpiry = expiry;
  await user.save();

  await transporter.sendMail({
    to: email,
    subject: 'Password Reset Code',
    html: `<p>Your reset code is <b>${code}</b>. It will expire in 5 minutes.</p>`,
  });

  res.json({ message: `Code sent to ${email}`, userType });
});

// Reset password route
app.post('/api/reset-password', async (req, res) => {
  const { email, code, password } = req.body;

  let user = await Faculty.findOne({ email });
  if (!user) {
    user = await Registration.findOne({ email });
  }

  if (!user) return res.status(404).json({ message: 'User not found' });

  if (user.resetCode !== code || new Date() > user.resetCodeExpiry) {
    return res.status(400).json({ message: 'Invalid or expired code' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  user.password = hashedPassword;
  user.resetCode = undefined;
  user.resetCodeExpiry = undefined;

  await user.save();

  res.json({ message: 'Password reset successful!' });
});


function isValidEmail(email) {
  if (!email) return false;

  // Basic email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Function to send reminder email
// async function sendReminderEmail(student, installmentInfo, installmentNumber) {
//   try {
//     // Validate email before attempting to send
//     if (!isValidEmail(student.email)) {
//       console.log(`Invalid or missing email for student ID ${student._id}, name: ${student.fName} ${student.lName}`);
//       return false;
//     }

//     // Format student name, handling empty values
//     const studentName = `${student.fName || ''} ${student.lName || ''}`.trim() || 'Student';

//     const mailOptions = {
//       from: 'sree.excerpt@gmail.com', // Replace with your actual email
//       to: student.email,
//       subject: `Payment Reminder: Installment #${installmentNumber} Due Soon`,
//       html: `
//           <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//             <h2>Payment Reminder</h2>
//             <p>Dear ${studentName},</p>
//             <p>This is a reminder that your installment #${installmentNumber} of amount <strong>₹${installmentInfo.amount}</strong> is due on <strong>${new Date(installmentInfo.dueDate).toLocaleDateString()}</strong>.</p>
//             <p>Course: ${student.courseName || 'Your enrolled course'}</p>
//             <p>Please ensure timely payment to avoid any inconvenience.</p>
//             <p>If you have already made this payment, please disregard this reminder.</p>
//             <p>Thank you,</p>
//             <p>CADDESK Hyderabad</p>
//           </div>
//         `
//     };

//     const info = await transporter.sendMail(mailOptions);
//     console.log(`Email sent to ${student.email}:`, info.messageId);
//     return true;
//   } catch (error) {
//     console.error('Error sending email:', error);
//     return false;
//   }
// }
async function sendReminderEmail(student, installmentInfo, installmentNumber) {
  try {
    // Validate email before attempting to send
    if (!isValidEmail(student.email)) {
      console.log(`Invalid or missing email for student ID ${student._id}, name: ${student.fName} ${student.lName}`);
      return false;
    }

    // Format student name, handling empty values
    const studentName = `${student.fName || ''} ${student.lName || ''}`.trim() || 'Student';

    const mailOptions = {
      from: 'info@jbkacademy.in', // Replace with your actual email
      to: student.email,
      subject: `Payment Reminder: Installment #${installmentNumber} Due Soon`,
   html:`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Reminder</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
        
        <!-- Header Section -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px 40px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600; letter-spacing: 1px;">
              JBK Academy
            </h1>
            
        </div>

        <!-- Content Section -->
        <div style="padding: 40px; line-height: 1.6; color: #333333;">
            
            <!-- Alert Banner -->
            <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 15px; margin-bottom: 25px; border-left: 4px solid #f39c12;">
                <h2 style="color: #d68910; margin: 0 0 5px 0; font-size: 18px; font-weight: 600;">
                    📅 Payment Reminder
                </h2>
                <p style="color: #b7950b; margin: 0; font-size: 14px;">
                    Your upcoming payment is due soon
                </p>
            </div>

            <!-- Greeting -->
            <p style="font-size: 16px; margin-bottom: 20px; color: #2c3e50;">
                Dear <strong>${studentName}</strong>,
            </p>

            <!-- Main Message -->
            <p style="font-size: 15px; margin-bottom: 25px; color: #34495e;">
                We hope this message finds you well. This is a friendly reminder regarding your upcoming payment for your course with us.
            </p>

            <!-- Payment Details Card -->
            <div style="background-color: #f8f9fa; border-radius: 10px; padding: 25px; margin: 25px 0; border: 1px solid #e9ecef;">
                <h3 style="color: #2c3e50; margin: 0 0 20px 0; font-size: 18px; font-weight: 600; text-align: center; border-bottom: 2px solid #3498db; padding-bottom: 10px;">
                    Payment Details
                </h3>
                
                <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                    <div style="flex: 1;">
                        <p style="margin: 0; color: #7f8c8d; font-size: 14px; font-weight: 500;">Course Name:</p>
                        <p style="margin: 5px 0 0 0; color: #2c3e50; font-size: 16px; font-weight: 600;">
                            ${student.courseName || 'Your Enrolled Course'}
                        </p>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                    <div style="flex: 1; margin-right: 20px;">
                        <p style="margin: 0; color: #7f8c8d; font-size: 14px; font-weight: 500;">Installment Number:</p>
                        <p style="margin: 5px 0 0 0; color: #e74c3c; font-size: 18px; font-weight: 700;">
                            #${installmentNumber}
                        </p>
                    </div>
                    <div style="flex: 1;">
                        <p style="margin: 0; color: #7f8c8d; font-size: 14px; font-weight: 500;">Amount Due:</p>
                        <p style="margin: 5px 0 0 0; color: #27ae60; font-size: 20px; font-weight: 700;">
                            ₹${installmentInfo.amount}
                        </p>
                    </div>
                </div>

                <div style="text-align: center; margin-top: 20px; padding: 15px; background-color: #fff; border-radius: 8px; border: 2px dashed #e74c3c;">
                    <p style="margin: 0; color: #7f8c8d; font-size: 14px; font-weight: 500;">Due Date:</p>
                    <p style="margin: 5px 0 0 0; color: #e74c3c; font-size: 22px; font-weight: 700;">
                        ${new Date(installmentInfo.dueDate).toLocaleDateString('en-IN', { 
                            weekday: 'long', 
                            year: 'numeric', 
                            month: 'long', 
                            day: 'numeric' 
                        })}
                    </p>
                </div>
            </div>

            <!-- Important Notice -->
            <div style="background-color: #e8f5e8; border-radius: 8px; padding: 20px; margin: 25px 0; border-left: 4px solid #27ae60;">
                <h4 style="color: #1e7e34; margin: 0 0 10px 0; font-size: 16px; font-weight: 600;">
                    💡 Important Notice
                </h4>
                <p style="margin: 0; color: #155724; font-size: 14px; line-height: 1.5;">
                    Please ensure timely payment to avoid any inconvenience and to continue enjoying uninterrupted access to your course materials and sessions.
                </p>
            </div>

            

       
           
           
        </div>

        <!-- Contact Section -->
        <div style="background-color: #2c3e50; padding: 25px 40px; text-align: center;">
            <h4 style="color: #ecf0f1; margin: 0 0 15px 0; font-size: 16px;">Need Help?</h4>
            <div style="margin-bottom: 15px;">
                <p style="color: #bdc3c7; margin: 5px 0; font-size: 14px;">
                    📞 Phone: +91 919985023100
                </p>
                <p style="color: #bdc3c7; margin: 5px 0; font-size: 14px;">
                    ✉️ Email: info@jbkacademy.in
                </p>
                <p style="color: #bdc3c7; margin: 5px 0; font-size: 14px;">
                    📍 Address: JBK Academy Hyderabad, 
                </p>
            </div>
            
        </div>
    </div>
</body>
</html>`
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${student.email}:`, info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

// Function to check due payments
async function checkDuePayments() {
  const reminderResults = [];
  const today = new Date();

  try {
    console.log('Starting payment check at:', today.toISOString());
    // Find all registrations with pending payments
    const registrations = await Registration.find({
      'paymentsPlan.status': 'Pending'
    });

    console.log(`Found ${registrations.length} registrations with pending payments`);

    for (const student of registrations) {
      // Log student details for debugging
      console.log(`Processing student: ID=${student._id}, Name=${student.fName} ${student.lName}, Email=${student.email || 'No email'}`);

      let currentInstallment = 0;
      let pendingFound = false;

      // Check each installment in the payment plan in order
      for (const payment of student.paymentsPlan) {
        currentInstallment++;

        // If this payment is pending, we need to check if it's due soon
        if (payment.status === 'Pending') {
          pendingFound = true;

          console.log(`Found pending installment #${currentInstallment}, due date: ${payment.dueDate}, amount: ${payment.amount}`);

          // Make sure due date is in proper format
          const dueDate = new Date(payment.dueDate);
          const isValidDate = !isNaN(dueDate.getTime());

          if (!isValidDate) {
            console.log(`Invalid due date format: ${payment.dueDate}`);
            continue;
          }

          // Calculate days until due
          const daysUntilDue = Math.floor((dueDate - today) / (1000 * 60 * 60 * 24));
          console.log(`Days until due: ${daysUntilDue}`);

          // Send reminder if due date is within 2 days
          if (daysUntilDue >= 0 && daysUntilDue <= 2) {
            console.log(`Sending reminder for payment due in ${daysUntilDue} days`);
            const emailSent = await sendReminderEmail(student, payment, currentInstallment);

            reminderResults.push({
              studentId: student._id,
              studentName: `${student.fName || ''} ${student.lName || ''}`.trim(),
              email: student.email || 'No email',
              installmentNumber: currentInstallment,
              dueDate: payment.dueDate,
              amount: payment.amount,
              daysUntilDue,
              emailSent
            });
          }

          // Once we find the first pending payment, break the loop
          break;
        }
      }

      if (!pendingFound) {
        console.log(`No pending payments found for student ID ${student._id}`);
      }
    }

    return reminderResults;
  } catch (error) {
    console.error('Error checking due payments:', error);
    return [];
  }
}

// API endpoint to manually trigger payment reminders
app.post('/api/check-due-payments', async (req, res) => {
  try {
    const reminderResults = await checkDuePayments();
    res.status(200).json({
      success: true,
      message: 'Payment reminders processed',
      remindersSent: reminderResults
    });
  } catch (error) {
    console.error('Error in check-due-payments API:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payment reminders',
      error: error.message
    });
  }
});



// Schedule daily check (runs at 9:00 AM every day)
cron.schedule('0 6 * * *', async () => {
  console.log('Running scheduled payment reminder check:', new Date().toISOString());
  try {
    const results = await checkDuePayments();
    console.log(`Sent ${results.length} payment reminders`);
  } catch (error) {
    console.error('Error in scheduled payment check:', error);
  }
});
// cron.schedule('* * * * *', async () => {
//   console.log('Running scheduled payment reminder check:', new Date().toISOString());
//   try {
//     const results = await checkDuePayments();
//     console.log(`Sent ${results.length} payment reminders`);
//   } catch (error) {
//     console.error('Error in scheduled payment check:', error);
//   }
// });

app.get('/api/batches/student/:studentId', async (req, res) => {
  try {
    const studentId = req.params.studentId;
    console.log("std", studentId)
    // Find batches where the student is assigned - using new ObjectId()
    const batches = await Batch.find({
      assignedStudents: new mongoose.Types.ObjectId(studentId)
    })
      .populate('courseId')
      .populate({
        path: 'subject.faculty',
        select: 'name email'
      });

    res.json(batches);
  } catch (error) {
    console.error('Error fetching student batches:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


app.get('/api/registrations/user/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    const registration = await Registration.findOne({
      _id: new mongoose.Types.ObjectId(userId)
    })
      .populate('courseId')
      .populate('courseTypeId')
      .populate('selectedSubjects');

    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }

    res.json(registration);
  } catch (error) {
    console.error('Error fetching registration:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
app.get('/api/subjects/match', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    console.log("Finding subjects for user:", userId);

    // Step 1: Get user's registration data
    const registration = await Registration.findOne({
      _id: new mongoose.Types.ObjectId(userId)
    });

    if (!registration) {
      return res.status(404).json({ message: 'Student registration not found' });
    }

    console.log("Registration found. Selected subjects:", registration.selectedSubjects);

    // Step 2: Get the batches where the student is assigned
    const batches = await Batch.find({
      assignedStudents: new mongoose.Types.ObjectId(userId)
    }).populate({
      path: 'subject.subject',
      select: 'branchId branchName subjectCode subjectName information duration singlePaymentFee installmentPaymentFee'
    });

    if (!batches || batches.length === 0) {
      return res.status(404).json({ message: 'No batches found for this student' });
    }

    console.log(`Found ${batches.length} batches for student`);

    // Step 3: Extract subject objects from batches
    const batchSubjects = batches.flatMap(batch =>
      Array.isArray(batch.subject)
        ? batch.subject.map(s => s.subject)
        : []
    ).filter(Boolean);

    console.log("Batch subjects found:", batchSubjects.length);

    // Determine if selectedSubjects contains ObjectIds or codes
    const hasObjectIds = registration.selectedSubjects &&
      registration.selectedSubjects.length > 0 &&
      (typeof registration.selectedSubjects[0] === 'object' ||
        mongoose.Types.ObjectId.isValid(registration.selectedSubjects[0]));

    let selectedSubjectCodes = [];

    if (hasObjectIds) {
      // If we have ObjectIds, get the subject codes
      const subjectIds = registration.selectedSubjects.map(id =>
        typeof id === 'object' ? id._id : id
      );

      const registeredSubjects = await Subject.find({
        _id: { $in: subjectIds }
      });

      selectedSubjectCodes = registeredSubjects
        .filter(s => s && s.subjectCode)
        .map(s => s.subjectCode);
    } else {
      // If we already have codes, use them directly
      selectedSubjectCodes = registration.selectedSubjects.filter(Boolean);
    }

    console.log("Selected subject codes:", selectedSubjectCodes);

    // Step 4: Match subjects using subjectCode field and ensure we have complete subject data
    let matchingSubjects = batchSubjects.filter(subject => {
      if (!subject) return false;

      const subjectCode = subject.subjectCode ||
        (subject.code) ||
        (typeof subject === 'object' && subject.subjectCode);

      return subjectCode && selectedSubjectCodes.includes(subjectCode);
    });

    console.log(`Found ${matchingSubjects.length} matching subjects by code`);

    // Ensure we have all required fields for display
    const enrichedSubjects = matchingSubjects.map(subject => {
      return {
        _id: subject._id,
        subjectName: subject.subjectName || "Untitled Subject",
        information: subject.information || "No information available",
        imageUrl: "/assets/img/img-02.jpg", // Default image since your schema doesn't have imageUrl
        subjectCode: subject.subjectCode || "Unknown Code",
        branchName: subject.branchName || "Unknown Branch",
        duration: subject.duration ?
          `${subject.duration.value} ${subject.duration.type}` :
          "Duration not specified",
        fee: subject.singlePaymentFee || 0
      };
    });

    if (matchingSubjects.length === 0) {
      // Try another approach: fetch all subjects by codes with complete information
      const allSubjects = await Subject.find({
        subjectCode: { $in: selectedSubjectCodes }
      });

      console.log(`Found ${allSubjects.length} subjects by querying subject codes directly`);

      // Add default values for any missing fields
      const enrichedAllSubjects = allSubjects.map(subject => ({
        _id: subject._id,
        subjectName: subject.subjectName || "Untitled Subject",
        information: subject.information || "No information available",
        subjectCaption: subject.subjectCaption || "No subjectCaption available",
        imageUrl: "/assets/img/img-02.jpg", // Default image
        subjectCode: subject.subjectCode || "Unknown Code",
        branchName: subject.branchName || "Unknown Branch",
        duration: subject.duration ?
          `${subject.duration.value} ${subject.duration.type}` :
          "Duration not specified",
        fee: subject.singlePaymentFee || 0
      }));

      res.json(enrichedAllSubjects);
    } else {
      res.json(enrichedSubjects);
    }
  } catch (error) {
    console.error('Error matching subjects:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

const generateDepId = async () => {
  const lastDept = await Department.findOne().sort({ dep_id: -1 });
  if (!lastDept) return 'DEP001';

  const lastIdNum = parseInt(lastDept.dep_id.replace('DEP', ''));
  const newId = 'DEP' + String(lastIdNum + 1).padStart(3, '0');
  return newId;
};

// Routes
app.get('/api/departments', async (req, res) => {
  try {
    const departments = await Department.find();
    res.json(departments);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching departments' });
  }
});

app.post('/api/departments', async (req, res) => {
  try {
    const { departmentName } = req.body;

    if (!departmentName) {
      return res.status(400).json({ error: 'Department name is required' });
    }

    const dep_id = await generateDepId();
    const newDept = new Department({ dep_id, departmentName });
    const saved = await newDept.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error('❌ Error saving department:', err);
    res.status(500).json({ error: 'Server error while saving department' });
  }
});


// PUT: Update department by ID
app.put('/api/departments/:id', async (req, res) => {
  try {
    const { departmentName } = req.body;
    const updated = await Department.findByIdAndUpdate(
      req.params.id,
      { departmentName },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ error: 'Department not found' });
    }
    res.json(updated);
  } catch (err) {
    console.error('❌ Error updating department:', err);
    res.status(500).json({ error: 'Server error while updating department' });
  }
});

// DELETE: Delete department by ID
app.delete('/api/departments/:id', async (req, res) => {
  try {
    const deleted = await Department.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Department not found' });
    }
    res.json({ message: '✅ Department deleted successfully' });
  } catch (err) {
    console.error('❌ Error deleting department:', err);
    res.status(500).json({ error: 'Server error while deleting department' });
  }
});
// Updated route for new schema
// Updated route for new schema
app.get('/api/student/batches/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    // Find batches where the student is assigned
    const batches = await Batch.find({
      assignedStudents: userId
    })
      .populate('faculty', 'firstName lastName email phone department profilePhoto')
      .populate({
        path: 'subject.faculty',
        select: 'firstName lastName email phone department profilePhoto'
      })
      .lean(); // Use lean() to convert MongoDB documents to plain JS objects

    // Populate subject details and ensure faculty is populated for all subjects in each batch
    for (let batch of batches) {
      if (batch.subject && batch.subject.length > 0) {
        for (let subjectEntry of batch.subject) {
          // First, ensure faculty is properly populated for each subject
          if (subjectEntry.faculty && typeof subjectEntry.faculty === 'string') {
            // If faculty is just an ID string, populate it
            const facultyData = await mongoose.model('Faculty').findById(subjectEntry.faculty)
              .select('firstName lastName email phone department profilePhoto')
              .lean();

            if (facultyData) {
              console.log(`Populated faculty data for subject: ${facultyData.firstName} ${facultyData.lastName}`);
              subjectEntry.faculty = facultyData;
            }
          }

          // Then populate subject details
          if (subjectEntry.subject) {
            console.log(`Looking up subject with ID: ${subjectEntry.subject}`);

            // Search by SubjectId field (not subjectCode)
            const subjectDetails = await Subject.findOne({
              SubjectId: subjectEntry.subject
            }).lean();

            if (subjectDetails) {
              console.log(`Found subject: ${subjectDetails.SubjectName}`);
              // Add subject details to the batch
              subjectEntry.subjectDetails = {
                subjectName: subjectDetails.SubjectName,
                subjectCode: subjectDetails.SubjectId
              };
            } else {
              console.log(`No subject found for ID: ${subjectEntry.subject}`);
            }
          }
        }
      }

      // Log faculty data for this batch to debug
      console.log(`Batch ${batch.batchName} faculty data:`, batch.subject.map(s => s.faculty));
    }

    console.log(`Returning ${batches.length} batches for student ${userId}`);
    res.status(200).json(batches);
  } catch (error) {
    console.error('Error fetching student batches:', error);
    res.status(500).json({ message: 'Failed to fetch batches', error: error.message });
  }
});

app.post('/api/subjects/details', async (req, res) => {
  try {
    const { subjectCodes } = req.body;
    // Validate input
    if (!subjectCodes || !Array.isArray(subjectCodes) || subjectCodes.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Subject codes must be provided as a non-empty array'
      });
    }
    console.log(`Fetching details for ${subjectCodes.length} subject codes:`, subjectCodes);

    // Query the database for subjects using SubjectId field
    const subjects = await Subject.find({
      SubjectId: { $in: subjectCodes }
    });

    // Map to the format needed by frontend
    const subjectDetails = subjects.map(subject => ({
      subjectCode: subject.SubjectId,
      subjectName: subject.SubjectName
    }));

    // Add any missing subject codes with name = code itself
    const foundCodes = new Set(subjects.map(s => s.SubjectId));
    subjectCodes.forEach(code => {
      if (!foundCodes.has(code)) {
        subjectDetails.push({
          subjectCode: code,
          subjectName: code // fallback
        });
      }
    });

    res.status(200).json(subjectDetails);
  } catch (error) {
    console.error('Error fetching subject details:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching subject details',
      error: error.message
    });
  }
});

app.get('/api/subjects/match/std', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    console.log("Finding subjects for user:", userId);

    // Step 1: Get user's registration data
    const registration = await Registration.findOne({
      _id: new mongoose.Types.ObjectId(userId)
    });

    if (!registration) {
      return res.status(404).json({ message: 'Student registration not found' });
    }

    console.log("Registration found. Selected subjects:", registration.selectedSubjects);

    // Step 2: Get the batches where the student is assigned
    const batches = await Batch.find({
      assignedStudents: new mongoose.Types.ObjectId(userId)
    });

    if (!batches || batches.length === 0) {
      return res.status(404).json({ message: 'No batches found for this student' });
    }

    console.log(`Found ${batches.length} batches for student`);

    // Step 3: Extract subject IDs from batches - new schema has subject as string
    const batchSubjectIds = batches.flatMap(batch =>
      Array.isArray(batch.subject)
        ? batch.subject.map(s => s.subject)
        : []
    ).filter(Boolean);

    console.log("Batch subject IDs found:", batchSubjectIds.length);

    // Fetch the actual subject documents using the IDs
    const batchSubjects = await Subject.find({
      SubjectId: { $in: batchSubjectIds }
    });

    console.log(`Retrieved ${batchSubjects.length} subject documents`);

    // Determine if selectedSubjects contains ObjectIds or codes
    const hasObjectIds = registration.selectedSubjects &&
      registration.selectedSubjects.length > 0 &&
      (typeof registration.selectedSubjects[0] === 'object' ||
        mongoose.Types.ObjectId.isValid(registration.selectedSubjects[0]));

    let selectedSubjectCodes = [];

    if (hasObjectIds) {
      // If we have ObjectIds, get the subject codes
      const subjectIds = registration.selectedSubjects.map(id =>
        typeof id === 'object' ? id._id : id
      );

      const registeredSubjects = await Subject.find({
        _id: { $in: subjectIds }
      });

      selectedSubjectCodes = registeredSubjects
        .filter(s => s && s.SubjectId)
        .map(s => s.SubjectId);
    } else {
      // If we already have codes, use them directly
      selectedSubjectCodes = registration.selectedSubjects.filter(Boolean);
    }

    console.log("Selected subject codes:", selectedSubjectCodes);

    // Step 4: Match subjects using SubjectId field
    let matchingSubjects = batchSubjects.filter(subject => {
      if (!subject) return false;
      return subject.SubjectId && selectedSubjectCodes.includes(subject.SubjectId);
    });

    console.log(`Found ${matchingSubjects.length} matching subjects by code`);

    // Ensure we have all required fields for display - with new schema field names
    const enrichedSubjects = matchingSubjects.map(subject => {
      return {
        _id: subject._id,
        subjectName: subject.SubjectName || "Untitled Subject",
        information: subject.SubjectDesc || "No information available",
        caption: subject.SubjectCaption || "No caption available",
        imageUrl: "/assets/img/img-02.jpg", // Default image
        subjectCode: subject.SubjectId || "Unknown Code",
        // Map any other fields you need
        branchName: "Branch", // You'll need to populate MasterBranchID if you want the branch name
        duration: "Duration not specified",
        fee: 0
      };
    });

    if (matchingSubjects.length === 0) {
      // Try another approach: fetch all subjects by codes with complete information
      const allSubjects = await Subject.find({
        SubjectId: { $in: selectedSubjectCodes }
      });

      console.log(`Found ${allSubjects.length} subjects by querying subject codes directly`);

      // Add default values for any missing fields - with new schema field names
      const enrichedAllSubjects = allSubjects.map(subject => ({
        _id: subject._id,
        subjectName: subject.SubjectName || "Untitled Subject",
        information: subject.SubjectDesc || "No information available",
        caption: subject.SubjectCaption || "No caption available",
        imageUrl: "/assets/img/img-02.jpg", // Default image
        subjectCode: subject.SubjectId || "Unknown Code",
        branchName: "Branch", // You'll need to populate MasterBranchID if you want the branch name
        duration: "Duration not specified",
        fee: 0
      }));

      res.json(enrichedAllSubjects);
    } else {
      res.json(enrichedSubjects);
    }
  } catch (error) {
    console.error('Error matching subjects:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.get('/api/batches/std/student/:studentId', async (req, res) => {
  try {
    const studentId = req.params.studentId;
    console.log("std", studentId)

    // Find batches where the student is assigned
    const batches = await Batch.find({
      assignedStudents: new mongoose.Types.ObjectId(studentId)
    })
      .populate({
        path: 'faculty',
        select: 'name email'
      })
      .populate({
        path: 'MasterBranchID',
        select: 'name'
      });

    // For each batch, we need to populate the subject information
    const batchesWithSubjectDetails = await Promise.all(batches.map(async batch => {
      const batchObj = batch.toObject();

      // For each subject in the batch, fetch the subject details from Subject collection
      if (Array.isArray(batchObj.subject)) {
        const subjectPromises = batchObj.subject.map(async subjectItem => {
          try {
            const subjectDoc = await Subject.findOne({ SubjectId: subjectItem.subject });
            if (subjectDoc) {
              return {
                ...subjectItem,
                subjectDetails: {
                  _id: subjectDoc._id,
                  SubjectName: subjectDoc.SubjectName,
                  SubjectDesc: subjectDoc.SubjectDesc,
                  SubjectCaption: subjectDoc.SubjectCaption
                }
              };
            }
            return subjectItem;
          } catch (err) {
            console.error(`Error fetching subject details for ${subjectItem.subject}:`, err);
            return subjectItem;
          }
        });

        batchObj.subject = await Promise.all(subjectPromises);
      }

      return batchObj;
    }));

    res.json(batchesWithSubjectDetails);
  } catch (error) {
    console.error('Error fetching student batches:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.post('/api/create-razorpay-order', async (req, res) => {
  try {
    const { amount, registrationId } = req.body;

    // Create shorter unique receipt ID (less than 40 chars)
    // Using timestamp in seconds instead of milliseconds and truncating the registration ID
    const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    const shortRegId = registrationId.substring(registrationId.length - 10); // Last 10 chars
    const receiptId = `r${timestamp}_${shortRegId}`;

    // Create order with Razorpay
    const options = {
      amount: amount, // amount in paise
      currency: "INR",
      receipt: receiptId,
      payment_capture: 1 // Auto capture payment
    };

    const order = await razorpay.orders.create(options);

    res.json({
      success: true,
      orderId: order.id
    });
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    res.status(500).json({ error: "Failed to create order", details: error.message });
  }
});

app.post('/api/verify-payment', async (req, res) => {
  try {
    const {
      registrationId,
      installmentId,
      razorpayPaymentId,
      razorpayOrderId,
      razorpaySignature,
      amount
    } = req.body;

    // Verify Razorpay signature
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'wsBV1ts8yJPld9JktATIdOiS')
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    const isSignatureValid = generatedSignature === razorpaySignature;

    if (!isSignatureValid) {
      return res.status(400).json({ success: false, error: "Invalid payment signature" });
    }

    // Fetch registration with branch info
    const registration = await Registration.findById(registrationId).populate('branchId');

    if (!registration) {
      return res.status(404).json({ success: false, error: "Registration not found" });
    }

    // Define branchIdString here so it's available in the whole function
    const branchIdString = registration.branchId?.branchCode || registration.branchId || 'UNK';
    const currentYear = new Date().getFullYear();

    // Helper function to generate unique receipt ID
    const generateReceiptId = async () => {
      // Find or create counter document for this branch and year
      let counter = await ReceiptCounter.findOne({
        branchId: branchIdString,
        year: currentYear
      });

      if (!counter) {
        // If no counter exists yet, create one starting at 0
        counter = new ReceiptCounter({
          branchId: branchIdString,
          year: currentYear,
          count: 0
        });
      }

      // Increment the counter
      counter.count += 1;
      await counter.save();

      // Format receipt ID with padded counter number
      const formattedCount = String(counter.count).padStart(2, '0');
      return `${branchIdString}/${currentYear}/${formattedCount}`;
    };

    // ---- Handle Single Payment ----
    if (registration.feeType === "Single") {
      const receiptId = await generateReceiptId();

      registration.singlePaymentStatus = "Paid";
      registration.singlePaymentDate = new Date().toISOString();
      registration.singlePaymentTransactionId = razorpayPaymentId;
      registration.receiptId = receiptId;

      if (!registration.paymentsPlan || registration.paymentsPlan.length === 0) {
        registration.paymentsPlan = [{
          amount: registration.courseFee,
          status: "Paid",
          paidDate: new Date().toISOString(),
          transactionId: razorpayPaymentId,
          paidAmount: registration.courseFee,
          razorpayOrderId: razorpayOrderId,
          receiptId: receiptId
        }];
      } else {
        const plan = registration.paymentsPlan[0];
        plan.status = "Paid";
        plan.paidDate = new Date().toISOString();
        plan.transactionId = razorpayPaymentId;
        plan.paidAmount = registration.courseFee;
        plan.razorpayOrderId = razorpayOrderId;
        plan.receiptId = receiptId;
      }
    }

    // ---- Handle Installment Payment ----
    else if (registration.feeType === "Installment") {
      const installment = installmentId
        ? registration.paymentsPlan.id(installmentId)
        : registration.paymentsPlan.find(plan => plan.status === "Pending");

      if (!installment) {
        return res.status(400).json({ success: false, error: "No pending installment found" });
      }

      // Generate a unique receipt ID for this installment
      const receiptId = await generateReceiptId();

      installment.status = "Paid";
      installment.paidDate = new Date().toISOString();
      installment.transactionId = razorpayPaymentId;
      installment.paidAmount = amount / 100;
      installment.razorpayOrderId = razorpayOrderId;
      installment.receiptId = receiptId;
    }

    await registration.save();

    res.json({
      success: true,
      message: "Payment verified and updated successfully"
    });

  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

const calculateRemainingBalance = (paymentsPlan) => {
  return paymentsPlan
    .filter(p => p.status === "Pending")
    .reduce((total, p) => total + parseFloat(p.amount || 0), 0);
};

const getTotalPaidAmount = (paymentsPlan) => {
  return paymentsPlan
    .filter(p => p.status === "Paid" || p.status === "Auto-Paid")
    .reduce((total, p) => total + parseFloat(p.paidAmount || 0), 0);
};

const cleanupZeroAmountInstallments = (paymentsPlan) => {
  return paymentsPlan.filter(p => parseFloat(p.amount || 0) > 0 || p.status === "Paid" || p.status === "Auto-Paid");
};
// app.put("/api/update-payment/:registrationId", async (req, res) => {
//   try {
//     const { registrationId } = req.params;
//     const { transactionId, amount, receivedBy, installmentId,paymentMode } = req.body;
// console.log("Received data:", req.body);
//     // Find the registration
//     const registration = await Registration.findById(registrationId);

//     if (!registration) {
//       return res.status(404).json({ error: "Registration not found" });
//     }

//     // Define branchIdString here so it's available for the receipt ID generation
//     const branchIdString = registration.branchId?.branchCode || registration.branchId || 'UNK';
//     const currentYear = new Date().getFullYear();

//     // Helper function to generate unique receipt ID
//     const generateReceiptId = async () => {
//       // Find or create counter document for this branch and year
//       let counter = await ReceiptCounter.findOne({
//         branchId: branchIdString,
//         year: currentYear
//       });

//       if (!counter) {
//         // If no counter exists yet, create one starting at 0
//         counter = new ReceiptCounter({
//           branchId: branchIdString,
//           year: currentYear,
//           count: 0
//         });
//       }

//       // Increment the counter
//       counter.count += 1;
//       await counter.save();

//       // Format receipt ID with padded counter number
//       const formattedCount = String(counter.count).padStart(2, '0');
//       return `${branchIdString}/${currentYear}/${formattedCount}`;
//     };

//     // Handle single payment type
//     if (registration.feeType === "Single") {
//       // Generate unique receipt ID
//       const receiptId = await generateReceiptId();

//       // Add specific fields for single payment tracking
//       registration.singlePaymentStatus = "Paid";
//       registration.singlePaymentDate = new Date().toISOString();
//       registration.singlePaymentTransactionId = transactionId || `TXN${Date.now()}`;
//       registration.singlepaymentrecivedby = receivedBy;
//       registration.singlePaymentMode = paymentMode; // Add payment mode
//       registration.singlePaymentReceiptId = receiptId; // Add receipt ID here

//       // Create a single payment plan if not exists
//       if (!registration.paymentsPlan || registration.paymentsPlan.length === 0) {
//         registration.paymentsPlan = [{
//           amount: registration.courseFee,
//           status: "Paid",
//           paidDate: new Date().toISOString(),
//           transactionId: transactionId || `TXN${Date.now()}`,
//           paidAmount: registration.courseFee,
//           receivedBy: receivedBy,
//           receiptId: receiptId ,
//         paymentMode:paymentMode 
//         }];
//       } else {
//         // Update the first (or only) payment plan
//         registration.paymentsPlan[0].status = "Paid";
//         registration.paymentsPlan[0].paidDate = new Date().toISOString();
//         registration.paymentsPlan[0].transactionId = transactionId || `TXN${Date.now()}`;
//         registration.paymentsPlan[0].paidAmount = registration.courseFee;
//         registration.paymentsPlan[0].receivedBy = receivedBy;
//         registration.paymentsPlan[0].receiptId = receiptId; // Add receipt ID here
//         registration.paymentsPlan[0].paymentMode = paymentMode; // Add payment mode
//       }
//     }
//     // Handle installment payment type
//  // Replace your installment handling section in the API route with this:

// else if (registration.feeType === "Installment") {
//   // Find the specified installment or first unpaid installment
//   const installmentToUpdate = installmentId
//     ? registration.paymentsPlan.id(installmentId)
//     : registration.paymentsPlan.find(installment => installment.status === "Pending");

//   if (!installmentToUpdate) {
//     return res.status(400).json({ error: "No pending installments found" });
//   }

//   const paidAmount = parseFloat(amount);
//   const dueAmount = parseFloat(installmentToUpdate.amount);
  
//   // Generate unique receipt ID for this installment
//   const receiptId = await generateReceiptId();

//   // Update the current installment
//   installmentToUpdate.status = "Paid";
//   installmentToUpdate.paidDate = new Date().toISOString();
//   installmentToUpdate.transactionId = transactionId || `TXN${Date.now()}`;
//   installmentToUpdate.paidAmount = paidAmount;
//   installmentToUpdate.receivedBy = receivedBy;
//   installmentToUpdate.receiptId = receiptId;
//   installmentToUpdate.paymentMode = paymentMode;

//   // Calculate difference
//   const difference = paidAmount - dueAmount;

//   if (difference !== 0) {
//     // Handle overpayment or underpayment
//     const currentIndex = registration.paymentsPlan.findIndex(p => p._id.toString() === installmentToUpdate._id.toString());
    
//     if (difference > 0) {
//       // OVERPAYMENT CASE: Reduce next installments
//       let remainingCredit = difference;
      
//       for (let i = currentIndex + 1; i < registration.paymentsPlan.length && remainingCredit > 0; i++) {
//         const nextInstallment = registration.paymentsPlan[i];
        
//         if (nextInstallment.status === "Pending") {
//           const nextAmount = parseFloat(nextInstallment.amount);
          
//           if (remainingCredit >= nextAmount) {
//             // This installment is fully covered
//             nextInstallment.amount = 0;
//             nextInstallment.status = "Auto-Paid";
//             nextInstallment.paidDate = new Date().toISOString();
//             nextInstallment.paidAmount = nextAmount;
//             nextInstallment.transactionId = `AUTO-${receiptId}`;
//             nextInstallment.receivedBy = receivedBy;
//             nextInstallment.paymentMode = "Auto-Adjustment";
//             remainingCredit -= nextAmount;
//           } else {
//             // Partial reduction
//             nextInstallment.amount = nextAmount - remainingCredit;
//             remainingCredit = 0;
//           }
//         }
//       }
//     } else {
//       // UNDERPAYMENT CASE: Add remaining amount to next installment or create new one
//       const shortfall = Math.abs(difference);
//       const nextInstallmentIndex = currentIndex + 1;
      
//       if (nextInstallmentIndex < registration.paymentsPlan.length) {
//         // Add to next existing installment
//         const nextInstallment = registration.paymentsPlan[nextInstallmentIndex];
//         if (nextInstallment.status === "Pending") {
//           nextInstallment.amount = parseFloat(nextInstallment.amount) + shortfall;
//         }
//       } else {
//         // Create new installment for remaining amount
//         const newDueDate = new Date();
//         newDueDate.setMonth(newDueDate.getMonth() + 1); // 1 month from now
        
//         registration.paymentsPlan.push({
//           dueDate: newDueDate.toISOString().split('T')[0],
//           amount: shortfall,
//           status: "Pending"
//         });
//       }
//     }
//   }
// }

//     // Save the updated registration
//     await registration.save();

//     res.json({
//       message: "Payment updated successfully",
//       updatedRegistration: registration
//     });
//   } catch (error) {
//     console.error("Error updating payment:", error);
//     res.status(500).json({ error: "Server error" });
//   }
// });
app.put("/api/update-payment/:registrationId", async (req, res) => {
  try {
    const { registrationId } = req.params;
    const { transactionId, amount, receivedBy, installmentId, paymentMode } = req.body;
    console.log("Received data receipt:", req.body);
    
    // Find the registration
    const registration = await Registration.findById(registrationId);

    if (!registration) {
      return res.status(404).json({ error: "Registration not found" });
    }

    // Define branchIdString here so it's available for the receipt ID generation
    const branchIdString = registration.branchId?.branchCode || registration.branchId || 'UNK';
    const currentYear = new Date().getFullYear();

    // Helper function to generate unique receipt ID
    const generateReceiptId = async () => {
      // Find or create counter document for this branch and year
      let counter = await ReceiptCounter.findOne({
        branchId: branchIdString,
        year: currentYear
      });

      if (!counter) {
        // If no counter exists yet, create one starting at 0
        counter = new ReceiptCounter({
          branchId: branchIdString,
          year: currentYear,
          count: 0
        });
      }

      // Increment the counter
      counter.count += 1;
      await counter.save();

      // Format receipt ID with padded counter number
      const formattedCount = String(counter.count).padStart(2, '0');
      return `${branchIdString}/${currentYear}/${formattedCount}`;
    };

    // Helper function to calculate total paid and remaining amount
    const calculateTotalAndRemaining = () => {
      const offeredFee = parseFloat(registration.offeredFee) || 0;
      let totalPaid = 0;

      // Calculate total paid from all installments
      if (registration.paymentsPlan && registration.paymentsPlan.length > 0) {
        totalPaid = registration.paymentsPlan.reduce((sum, installment) => {
          if (installment.status === "Paid" || installment.status === "Auto-Paid") {
            return sum + (parseFloat(installment.paidAmount) || 0);
          }
          return sum;
        }, 0);
      }

      const remainingAmount = Math.max(0, offeredFee - totalPaid);
      
      return { totalPaid, remainingAmount };
    };

    // Handle single payment type
    if (registration.feeType === "Single") {
      // Generate unique receipt ID
      const receiptId = await generateReceiptId();

      // Add specific fields for single payment tracking
      registration.singlePaymentStatus = "Paid";
      registration.singlePaymentDate = new Date().toISOString();
      registration.singlePaymentTransactionId = transactionId || `TXN${Date.now()}`;
      registration.singlepaymentrecivedby = receivedBy;
      registration.singlePaymentMode = paymentMode;
      registration.singlePaymentReceiptId = receiptId;

      // Create a single payment plan if not exists
      if (!registration.paymentsPlan || registration.paymentsPlan.length === 0) {
        registration.paymentsPlan = [{
          amount: registration.offeredFee,
          status: "Paid",
          paidDate: new Date().toISOString(),
          transactionId: transactionId || `TXN${Date.now()}`,
          paidAmount: registration.offeredFee,
          receivedBy: receivedBy,
          receiptId: receiptId,
          paymentMode: paymentMode 
        }];
      } else {
        // Update the first (or only) payment plan
        registration.paymentsPlan[0].status = "Paid";
        registration.paymentsPlan[0].paidDate = new Date().toISOString();
        registration.paymentsPlan[0].transactionId = transactionId || `TXN${Date.now()}`;
        registration.paymentsPlan[0].paidAmount = registration.offeredFee;
        registration.paymentsPlan[0].receivedBy = receivedBy;
        registration.paymentsPlan[0].receiptId = receiptId;
        registration.paymentsPlan[0].paymentMode = paymentMode;
      }

      // Calculate and update total paid and remaining amount for single payment
      const { totalPaid, remainingAmount } = calculateTotalAndRemaining();
      registration.totalPaid = totalPaid;
      registration.remainingAmount = remainingAmount;
    }
    // Handle installment payment type
    else if (registration.feeType === "Installment") {
      // Find the specified installment or first unpaid installment
      const installmentToUpdate = installmentId
        ? registration.paymentsPlan.id(installmentId)
        : registration.paymentsPlan.find(installment => installment.status === "Pending");

      if (!installmentToUpdate) {
        return res.status(400).json({ error: "No pending installments found" });
      }

      const paidAmount = parseFloat(amount);
      const dueAmount = parseFloat(installmentToUpdate.amount);
      
      // Generate unique receipt ID for this installment
      const receiptId = await generateReceiptId();

      // Update the current installment
      installmentToUpdate.status = "Paid";
      installmentToUpdate.paidDate = new Date().toISOString();
      installmentToUpdate.transactionId = transactionId || `TXN${Date.now()}`;
      installmentToUpdate.paidAmount = paidAmount;
      installmentToUpdate.receivedBy = receivedBy;
      installmentToUpdate.receiptId = receiptId;
      installmentToUpdate.paymentMode = paymentMode;

      // Calculate difference
      const difference = paidAmount - dueAmount;

      if (difference !== 0) {
        // Handle overpayment or underpayment
        const currentIndex = registration.paymentsPlan.findIndex(p => p._id.toString() === installmentToUpdate._id.toString());
        
        if (difference > 0) {
          // OVERPAYMENT CASE: Reduce next installments
          let remainingCredit = difference;
          
          for (let i = currentIndex + 1; i < registration.paymentsPlan.length && remainingCredit > 0; i++) {
            const nextInstallment = registration.paymentsPlan[i];
            
            if (nextInstallment.status === "Pending") {
              const nextAmount = parseFloat(nextInstallment.amount);
              
              if (remainingCredit >= nextAmount) {
                // This installment is fully covered
                nextInstallment.amount = 0;
                nextInstallment.status = "Auto-Paid";
                nextInstallment.paidDate = new Date().toISOString();
                nextInstallment.paidAmount = nextAmount;
                nextInstallment.transactionId = `AUTO-${receiptId}`;
                nextInstallment.receivedBy = receivedBy;
                nextInstallment.paymentMode = "Auto-Adjustment";
                remainingCredit -= nextAmount;
              } else {
                // Partial reduction
                nextInstallment.amount = nextAmount - remainingCredit;
                remainingCredit = 0;
              }
            }
          }
        } else {
          // UNDERPAYMENT CASE: Add remaining amount to next installment or create new one
          const shortfall = Math.abs(difference);
          const nextInstallmentIndex = currentIndex + 1;
          
          if (nextInstallmentIndex < registration.paymentsPlan.length) {
            // Add to next existing installment
            const nextInstallment = registration.paymentsPlan[nextInstallmentIndex];
            if (nextInstallment.status === "Pending") {
              nextInstallment.amount = parseFloat(nextInstallment.amount) + shortfall;
            }
          } else {
            // Create new installment for remaining amount
            const newDueDate = new Date();
            newDueDate.setMonth(newDueDate.getMonth() + 1); // 1 month from now
            
            registration.paymentsPlan.push({
              dueDate: newDueDate.toISOString().split('T')[0],
              amount: shortfall,
              status: "Pending"
            });
          }
        }
      }

      // Calculate and update total paid and remaining amount for installment payments
      const { totalPaid, remainingAmount } = calculateTotalAndRemaining();
      registration.totalPaid = totalPaid;
      registration.remainingAmount = remainingAmount;
    }

    // Save the updated registration
    await registration.save();

    res.json({
      message: "Payment updated successfully",
      updatedRegistration: registration,
      paymentSummary: {
        totalPaid: registration.totalPaid,
        remainingAmount: registration.remainingAmount,
        offeredFee: registration.offeredFee
      }
    });
  } catch (error) {
    console.error("Error updating payment:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/update-due-date/:registrationId/:installmentId", async (req, res) => {
  try {
    const { registrationId, installmentId } = req.params;
    const { dueDate } = req.body;

    console.log("Updating due date for registration:", registrationId, "installment:", installmentId, "to due date:", dueDate);
    // Find the registration
    const registration = await Registration.findById(registrationId);

    if (!registration) {
      return res.status(404).json({ error: "Registration not found" });
    }

    // Find the specific installment
    const installment = registration.paymentsPlan.id(installmentId);

    if (!installment) {
      return res.status(404).json({ error: "Installment not found" });
    }

    // Update the due date
    installment.dueDate = dueDate;

    // Save the updated registration
    await registration.save();

    res.json({
      message: "Due date updated successfully",
      updatedInstallment: installment
    });
  } catch (error) {
    console.error("Error updating due date:", error);
    res.status(500).json({ error: "Server error" });
  }
});


app.get('/api/profile/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    // Try to find user in Faculty collection first
    let user = await Faculty.findById(userId).select('-password');

    // If not found in Faculty, try Registration collection
    if (!user) {
      user = await Registration.findById(userId).select('-password');
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update user profile
app.put('/api/profile/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const updateData = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    // Remove sensitive fields that shouldn't be updated directly
    delete updateData.password;
    delete updateData.role;
    delete updateData._id;

    // Try to update in Faculty collection first
    let updatedUser = await Faculty.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    // If not found in Faculty, try Registration
    if (!updatedUser) {
      updatedUser = await Registration.findByIdAndUpdate(
        userId,
        { $set: updateData },
        { new: true, runValidators: true }
      ).select('-password');
    }

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Change password without requiring current password
app.put('/api/profile/change-password/:userId', async (req, res) => {
  try {
    const { newPassword } = req.body;
    const userId = req.params.userId;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    if (!newPassword) {
      return res.status(400).json({ message: 'New password is required' });
    }

    // Try to find user in Faculty collection
    let user = await Faculty.findById(userId);
    let isRegistration = false;

    // If not found in Faculty, try Registration
    if (!user) {
      user = await Registration.findById(userId);
      isRegistration = true;
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password in appropriate collection
    if (isRegistration) {
      await Registration.findByIdAndUpdate(userId, { password: hashedPassword });
    } else {
      await Faculty.findByIdAndUpdate(userId, { password: hashedPassword });
    }

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
app.post('/api/profile/upload-photo/:userId', uploadProfilePhoto.single('profilePhoto'), async (req, res) => {
  try {
    const userId = req.params.userId;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Path to the newly uploaded photo
    const photoPath = `profile/${req.file.filename}`;

    // Delete old photo if it exists
    if (req.body.oldPhotoPath) {
      const oldPhotoPath = req.body.oldPhotoPath;
      const fullPath = path.join(__dirname, oldPhotoPath);

      // Check if file exists before trying to delete
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }

    // Try to update in Faculty collection first
    let updatedUser = await Faculty.findByIdAndUpdate(
      userId,
      { $set: { profilePhoto: photoPath } },
      { new: true }
    );

    // If not found in Faculty, try Registration
    if (!updatedUser) {
      updatedUser = await Registration.findByIdAndUpdate(
        userId,
        { $set: { profilePhoto: photoPath } },
        { new: true }
      );
    }

    if (!updatedUser) {
      // Delete the uploaded file if user not found
      fs.unlinkSync(path.join(__dirname, photoPath));
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'Photo uploaded successfully', photoPath });
  } catch (error) {
    console.error('Error uploading profile photo:', error);

    // Delete the uploaded file if an error occurs
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST: Submit feedback
app.post("/api/feedback", async (req, res) => {
  try {
    const { studentId, batch, faculty, review, rating,  subject } = req.body;
    console.log(studentId, batch, faculty, review, rating,  subject)
    if (!studentId || !batch || !faculty || !review || !rating  || !subject) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Find the faculty by facultyId
    const faculty1 = await Faculty.findById(faculty);
    if (!faculty1) {
      return res.status(400).json({ message: "Faculty not found" });
    }

    // Add the feedback to the faculty's Feedbacks array
    faculty1.Feedbacks.push({
      studentId,
    
      batch,
      rating,
      review,
      subject
    });

    // Save the updated faculty document
    await faculty1.save();
    console.log("Feedback submitted successfully")
    res.status(201).json({ message: "Feedback submitted successfully", feedback: faculty1.Feedbacks });
  } catch (error) {
    console.error("Error submitting feedback:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// GET: Fetch feedback for a specific batch
app.get("/api/feedback/batch/:batchId", async (req, res) => {
  try {
    const { batchId } = req.params;

    const feedbacks = await Feedback.find({ batchId })
      .populate("userId", "fName lName email")
      .populate("facultyId", "firstName lastName email");

    res.status(200).json(feedbacks);
  } catch (error) {
    console.error("Error fetching feedback:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// GET: Fetch feedback for a specific faculty
app.get("/api/feedback/faculty/:facultyId", async (req, res) => {
  try {
    const { facultyId } = req.params;

    const faculty = await Faculty.findById(facultyId).select("Feedbacks");

    if (!faculty) {
      return res.status(404).json({ message: "Faculty not found" });
    }

    // Return the embedded feedbacks array
    res.status(200).json(faculty.Feedbacks);
  } catch (error) {
    console.error("Error fetching feedback:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// DELETE: Delete feedback by ID
app.delete("/api/feedback/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const feedback = await Feedback.findByIdAndDelete(id);

    if (!feedback) {
      return res.status(404).json({ message: "Feedback not found" });
    }

    res.status(200).json({ message: "Feedback deleted successfully" });
  } catch (error) {
    console.error("Error deleting feedback:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

app.post('/api/masterbranch', async (req, res) => {
  try {
    const { MasterBranchName, BranchesID } = req.body;

    if (!MasterBranchName || !BranchesID || !Array.isArray(BranchesID)) {
      return res.status(400).json({ message: 'Invalid input data' });
    }

    const masterBranch = new MasterBranch({
      MasterBranchName,
      BranchesID
    });

    const savedMasterBranch = await masterBranch.save();
    res.status(201).json(savedMasterBranch);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// app.get("/api/masterbranches", async (req, res) => {
//   try {
//     const masterBranches = await MasterBranch.find().populate("BranchesID");
//     res.json(masterBranches);
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// });

app.get('/api/masterbranches', async (req, res) => {
  try {
    const masterBranches = await MasterBranch.find().populate('BranchesID').lean();
    res.json(masterBranches);
  } catch (error) {
    console.error('Error fetching master branches:', error);
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/branches/bymaster/:masterBranchId', async (req, res) => {
  try {
    const { masterBranchId } = req.params;

    // Validate that masterBranchId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(masterBranchId)) {
      return res.status(400).json({ message: 'Invalid master branch ID' });
    }

    // Find the master branch by ID and populate its branches
    const masterBranch = await MasterBranch.findById(masterBranchId)
      .populate('BranchesID')
      .exec();

    if (!masterBranch) {
      return res.status(404).json({ message: 'Master branch not found' });
    }

    // Return the populated branches array
    res.json(masterBranch.BranchesID);
  } catch (error) {
    console.error('Error fetching branches by master:', error);
    res.status(500).json({ message: 'Error fetching branches', error: error.message });
  }
});

app.put('/api/masterbranch/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { MasterBranchName, BranchesID } = req.body;

    if (!MasterBranchName || !BranchesID || !Array.isArray(BranchesID)) {
      return res.status(400).json({ message: 'Invalid input data' });
    }

    const updatedMasterBranch = await MasterBranch.findByIdAndUpdate(
      id,
      { MasterBranchName, BranchesID },
      { new: true, runValidators: true }
    );

    if (!updatedMasterBranch) {
      return res.status(404).json({ message: 'MasterBranch not found' });
    }

    res.status(200).json(updatedMasterBranch);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete('/api/masterbranch/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const deletedMasterBranch = await MasterBranch.findByIdAndDelete(id);

    if (!deletedMasterBranch) {
      return res.status(404).json({ message: 'MasterBranch not found' });
    }

    res.status(200).json({ message: 'MasterBranch deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/coursetype', async (req, res) => {
  try {
    const { CourseTypeId, CourseTypeName, MasterBranchID } = req.body;

    if (!CourseTypeId || !CourseTypeName || !MasterBranchID) {
      return res.status(400).json({ message: 'Invalid input data' });
    }

    const courseType = new CourseType({
      CourseTypeId,
      CourseTypeName,
      MasterBranchID,
      // courseTypeCode: CourseTypeId // Set courseTypeCode explicitly
    });

    const savedCourseType = await courseType.save();
    res.status(201).json(savedCourseType);
  } catch (error) {
    console.error("Error in /api/coursetype:", error);

    // Improved error handling
    if (error.code === 11000) { // Duplicate key error
      return res.status(400).json({
        message: 'A course type with this ID already exists. Please use a different ID.'
      });
    }

    res.status(500).json({ message: error.message });
  }
});

app.get('/api/coursetypes', async (req, res) => {
  try {
    const courseTypes = await CourseType.find().populate({
    path: 'MasterBranchID',
    populate: {
      path: 'BranchesID'
    }
  });
    res.status(200).json(courseTypes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/coursetype/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { CourseTypeId, CourseTypeName, MasterBranchID } = req.body;

    if (!CourseTypeId || !CourseTypeName || !MasterBranchID) {
      return res.status(400).json({ message: 'Invalid input data' });
    }

    const updatedCourseType = await CourseType.findByIdAndUpdate(
      id,
      {
        CourseTypeId,
        CourseTypeName,
        MasterBranchID,
        // courseTypeCode: CourseTypeId // Update courseTypeCode too
      },
      { new: true, runValidators: true }
    );

    if (!updatedCourseType) {
      return res.status(404).json({ message: 'CourseType not found' });
    }

    res.status(200).json(updatedCourseType);
  } catch (error) {
    console.error("Error in PUT /api/coursetype:", error);

    // Improved error handling
    if (error.code === 11000) { // Duplicate key error
      return res.status(400).json({
        message: 'A course type with this ID already exists. Please use a different ID.'
      });
    }

    res.status(500).json({ message: error.message });
  }
});

app.delete('/api/coursetype/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const deletedCourseType = await CourseType.findByIdAndDelete(id);

    if (!deletedCourseType) {
      return res.status(404).json({ message: 'CourseType not found' });
    }

    res.status(200).json({ message: 'CourseType deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
          
app.get('/api/masterbranches', async (req, res) => {
  try {
    const branches = await MasterBranch.find().populate("BranchesID");
    res.json(branches);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET Course Types with filter
app.get('/api/v1/coursetypes', async (req, res) => {
  const { branchId } = req.query;
  try {
    const filter = branchId ? { MasterBranchID: new mongoose.Types.ObjectId(branchId) } : {};
    const courseTypes = await CourseType.find(filter);
    res.json(courseTypes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// GET All Courses
app.get('/api/courses', async (req, res) => {
  try {
    const courses = await Course.find()
  .populate('CourseTypeID')
  .populate({
    path: 'MasterBranchID',
    populate: {
      path: 'BranchesID'
    }
  });
    
    res.json(courses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
app.get('/api/v1/courses', async (req, res) => {
  try {
    const courses = await Course.find()
    res.json(courses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST Create Course
app.post('/api/course', async (req, res) => {
  console.log("Course new data:", req.body); // Log the incoming course data
  try {
    const newCourse = new Course(req.body);
    await newCourse.save();
    res.status(201).json(newCourse);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT Update Course
app.put('/api/course/:id', async (req, res) => {
  try {
    const updated = await Course.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE Course
app.delete('/api/course/:id', async (req, res) => {
  try {
    await Course.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.post('/api/subject', async (req, res) => {
  try {
    console.log("sree",req.body)
    const { SubjectId, SubjectName, coursesids, SubjectCaption, SubjectDesc } = req.body;
    console.log("Subject new data:", req.body); // Log the incoming subject data
    if (!SubjectId || !SubjectName || !coursesids || !Array.isArray(coursesids) || !SubjectCaption || !SubjectDesc) {
      return res.status(400).json({ message: 'Invalid input data' });
    }

    const subject = new Subject({
      SubjectId,
      SubjectName,
      coursesids,
      SubjectCaption,
      SubjectDesc,
      MasterBranchID: req.body.MasterBranchID // Ensure MasterBranchID is included

    });

    const savedSubject = await subject.save();
    res.status(201).json(savedSubject);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/courses/bybranch/:branchId', async (req, res) => {
  try {
    const courses = await Course.find({ MasterBranchID: req.params.branchId });
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch courses by branch' });
  }
});
app.get('/api/subjects', async (req, res) => {
  try {
    const subjects = await Subject.find().populate('coursesids').populate({
    path: 'MasterBranchID',
    populate: {
      path: 'BranchesID'
    }
  });
    res.status(200).json(subjects);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
app.get('/api/old/subjects', async (req, res) => {
  try {
    const subjects = await Subject.find()
    res.status(200).json(subjects);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
// New route to get subjects by course ID
app.get('/api/courses/:courseId/subjects', async (req, res) => {
  try {
    const courseId = req.params.courseId;
    const subjects = await Subject.find({ coursesids: courseId }); // Match ObjectId

    if (!subjects || subjects.length === 0) {
      return res.status(404).json({ message: 'No subjects found for this course' });
    }

    res.json(subjects);
  } catch (error) {
    console.error("Error fetching subjects by course:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/subjects/bymasterbranch/:masterBranchId', async (req, res) => {
  try {
    const masterBranchId = req.params.masterBranchId;

    // Validate if the masterBranchId is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(masterBranchId)) {
      return res.status(400).json({
        message: 'Invalid master branch ID format'
      });
    }

    // Convert string to ObjectId
    const objectIdMasterBranch = new mongoose.Types.ObjectId(masterBranchId);

    // Find all courses associated with this master branch using the ObjectId
    const courses = await Course.find({ MasterBranchID: objectIdMasterBranch });

    if (!courses || courses.length === 0) {
      return res.status(404).json({ message: 'No courses found for this master branch' });
    }

    // Extract all course IDs
    const courseIds = courses.map(course => course._id);

    // Find all subjects associated with these courses
    const subjects = await Subject.find({ coursesids: { $in: courseIds } });

    if (!subjects || subjects.length === 0) {
      return res.status(404).json({ message: 'No subjects found for courses in this master branch' });
    }

    res.json(subjects);
  } catch (error) {
    console.error("Error fetching subjects by master branch:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/subject/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { SubjectId, SubjectName, coursesids, SubjectCaption, SubjectDesc } = req.body;

    if (!SubjectId || !SubjectName || !coursesids || !Array.isArray(coursesids) || !SubjectCaption || !SubjectDesc) {
      return res.status(400).json({ message: 'Invalid input data' });
    }

    const updatedSubject = await Subject.findByIdAndUpdate(
      id,
      { SubjectId, SubjectName, coursesids, SubjectCaption, SubjectDesc },
      { new: true, runValidators: true }
    );

    if (!updatedSubject) {
      return res.status(404).json({ message: 'Subject not found' });
    }

    res.status(200).json(updatedSubject);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete('/api/subject/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const deletedSubject = await Subject.findByIdAndDelete(id);

    if (!deletedSubject) {
      return res.status(404).json({ message: 'Subject not found' });
    }

    res.status(200).json({ message: 'Subject deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/scheduling/master-branches', async (req, res) => {
  try {
    const masterBranches = await MasterBranch.find().select('_id MasterBranchName');
    res.json(masterBranches);
  } catch (error) {
    console.error('Error fetching master branches:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get branches by master branch ID
app.get('/api/scheduling/branches/:masterBranchId', async (req, res) => {
  try {
    const masterBranch = await MasterBranch.findById(req.params.masterBranchId)
      .populate('BranchesID');

    if (!masterBranch) {
      return res.status(404).json({ message: 'Master branch not found' });
    }
    res.json(masterBranch.BranchesID);
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get batches by branch ID
app.get('/api/scheduling/batches/:branchId', async (req, res) => {
  console.log("Fetching batches for branch ID:", req.params.branchId); // Log the branch ID

  try {
    const batches = await Batch.find({
      branchId: req.params.branchId,
      status: { $in: ["to be start", "extended", "running"] } // Only active batches
    }).select('_id batchName batchId');

    res.json(batches);
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get faculties by branch ID
app.get('/api/scheduling/faculties/:branchId', async (req, res) => {
  console.log("Fetching faculties for branch ID:", req.params.branchId); // Log the branch ID
  try {
    const faculties = await Faculty.find({
      branchId: req.params.branchId,
      status: "Active",// Only active faculties
      role:'Faculty'
    }).select('_id firstName lastName employeeId');
    console.log("Faculties found:", faculties); // Log the fetched faculties
    res.json(faculties);
  } catch (error) {
    console.error('Error fetching faculties:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get batch schedule by batch ID - FIXED: proper chaining of methods
app.get('/api/scheduling/batch-schedule/:batchId', async (req, res) => {
  console.log("Fetching schedule for batch ID:", req.params.batchId); // Log the batch ID
  try {
    const batch = await Batch.findOne({ batchId: req.params.batchId })
      .populate({
        path: 'subject.faculty',
        select: 'firstName lastName'
      });

    if (!batch) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    res.json([batch]); // Return as array for consistency with frontend
  } catch (error) {
    console.error('Error fetching batch schedule:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get faculty schedule by faculty ID



app.get('/api/scheduling/faculty-schedule/:facultyId', async (req, res) => {
  try {
    const facultyId = req.params.facultyId;
    if (!mongoose.Types.ObjectId.isValid(facultyId)) {
      return res.status(400).json({ message: 'Invalid Faculty ID' });
    }
    const facultyObjectId = new mongoose.Types.ObjectId(facultyId);
    const batches = await Batch.find({
      'subject.faculty': facultyObjectId,
      status: { $in: ["to be start", "running"] }
    });
    if (!batches || batches.length === 0) {
      return res.json([]);
    }
    const scheduleData = [];
    batches.forEach(batch => {
      batch.subject.forEach(subjectItem => {
        if (
          subjectItem.faculty &&
          subjectItem.faculty.toString() === facultyId &&
          subjectItem.schedule && 
          Array.isArray(subjectItem.schedule)
        ) {
          subjectItem.schedule.forEach(scheduleItem => {
            scheduleData.push({
              day: scheduleItem.day,
              timeSlot: scheduleItem.timeSlot,
              subject: subjectItem.subject,
              batchId: batch._id,
              batchName: batch.batchName
            });
          });
        }
      });
    });
    res.json(scheduleData);
  } catch (error) {
    console.error('Error fetching faculty schedule:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


app.get('/api/student-batches', async (req, res) => {
  try {
    const userId = req.query.userId;
    console.log("Fetching batches for student ID:", userId); // Log the user ID
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    const batches = await Batch.find({
      assignedStudents: userId
    }).select('batchId batchName subject startDate status');

    console.log("Batches found for student:", batches); // Log the fetched batches
    res.json(batches);
  } catch (error) {
    console.error('Error fetching student batches:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.get('/api/user/profile/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    // Validate userId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format' });
    }

    // Find user in Registration schema
    const user = await Registration.findById(userId).select('-password -role -resetCode -resetCodeExpiry');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json(user);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// API to get course types, courses, and subjects based on branch
app.get('/api/courses/by-branch', async (req, res) => {
  try {
    const { branchId } = req.query;

    if (!branchId) {
      return res.status(400).json({ success: false, message: 'Branch ID is required' });
    }

    // Find branch
    const branch = await Branch.findOne({ branchId });
    if (!branch) {
      return res.status(404).json({ success: false, message: 'Branch not found' });
    }

    // Find master branch containing this branch
    const masterBranch = await MasterBranch.findOne({ BranchesID: branch._id });
    if (!masterBranch) {
      return res.status(404).json({ success: false, message: 'Master branch not found' });
    }

    // Find course types for this master branch
    const courseTypes = await CourseType.find({ MasterBranchID: masterBranch._id });

    // Find courses for this master branch
    const courses = await Course.find({ MasterBranchID: masterBranch._id });

    // Find subjects for this master branch
    const subjects = await Subject.find({ MasterBranchID: masterBranch._id });

    return res.status(200).json({
      success: true,
      courseTypes,
      courses,
      subjects
    });
  } catch (error) {
    console.error('Error fetching course data:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// API to express interest in a batch with full registration details
app.post('/api/batches/express-interest', async (req, res) => {
  try {
    const {
      userId,
      batchId,
      userData,
      courseTypeId,
      courseId,
      selectedSubjects,
      courseName,
      courseFee,
      notes
    } = req.body;

    // Validate required fields
    if (!userId || !batchId) {
      return res.status(400).json({ success: false, message: 'User ID and Batch ID are required' });
    }

    // Validate ID formats
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format' });
    }

    if (!mongoose.Types.ObjectId.isValid(batchId)) {
      return res.status(400).json({ success: false, message: 'Invalid batch ID format' });
    }

    // Check if user already expressed interest in this batch
    const existingInterest = await BatchInterest.findOne({ userId, batchId });
    if (existingInterest) {
      return res.status(400).json({
        success: false,
        message: 'You have already expressed interest in this batch'
      });
    }

    // Get user's original data
    const user = await Registration.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Get branch info from user
    const branchId = user.branchId;

    // Create a new batch interest record with full registration details
    const newInterest = new BatchInterest({
      userId,
      batchId,
      regDetails: {
        fName: userData.fName,
        lName: userData.lName,
        guardianName: userData.guardianName,
        contactAddress: userData.contactAddress,
        email: userData.email,
        city: userData.city,
        state: userData.state,
        qualification: userData.qualification,
        otherQualification: userData.otherQualification,
        collegeName: userData.collegeName,
        phone: userData.phone,
        branchId: branchId,
        source: userData.source || user.source,
        ReferralName: userData.ReferralName || user.ReferralName,
        regid: userData.regid || user.regid, // Ensuring regid is saved in regDetails
      },
      courseDetails: {
        courseTypeId,
        courseId,
        selectedSubjects,
        courseName,
        courseFee
      },
      notes
    });

    await newInterest.save();

    // Update the user's basic information in Registration schema
    await Registration.findByIdAndUpdate(userId, {
      fName: userData.fName,
      lName: userData.lName,
      guardianName: userData.guardianName,
      contactAddress: userData.contactAddress,
      email: userData.email,
      city: userData.city,
      state: userData.state,
      qualification: userData.qualification,
      otherQualification: userData.otherQualification,
      collegeName: userData.collegeName,
      phone: userData.phone,
      regid: userData.regid || user.regid, // Ensuring regid is updated
      source: userData.source || user.source,
      ReferralName: userData.ReferralName || user.ReferralName
    });

    return res.status(200).json({
      success: true,
      message: 'Interest in batch expressed successfully'
    });
  } catch (error) {
    console.error('Error expressing interest:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});
// API to check if user has already expressed interest in a batch


// app.post('/api/assign-multiple-batches', async (req, res) => {
//   try {
//     const { studentId, batchIds } = req.body;

//     // Validate request
//     if (!studentId || !batchIds || !Array.isArray(batchIds) || batchIds.length === 0) {
//       return res.status(400).json({ error: 'Invalid request. Student ID and at least one batch ID are required.' });
//     }

//     // Validate student ID
//     if (!mongoose.Types.ObjectId.isValid(studentId)) {
//       return res.status(400).json({ error: 'Invalid student ID format.' });
//     }

//     // Validate batch IDs
//     for (const batchId of batchIds) {
//       if (!mongoose.Types.ObjectId.isValid(batchId)) {
//         return res.status(400).json({ error: `Invalid batch ID format: ${batchId}` });
//       }
//     }

//     // Find student registration
//     const registration = await Registration.findById(studentId);
//     if (!registration) {
//       return res.status(404).json({ error: 'Student registration not found.' });
//     }

//     // Find all batches
//     const batches = await Batch.find({ _id: { $in: batchIds } });
//     console.log("Batches found:", batches); // Log the fetched batches
//     if (batches.length !== batchIds.length) {
//       return res.status(400).json({ error: 'One or more selected batches not found.' });
//     }

//     // Check if batches have capacity
//     for (const batch of batches) {
//       if (batch.remainingStudentCount <= 0) {
//         return res.status(400).json({
//           error: `Batch ${batch.batchName} has no remaining slots.`
//         });
//       }
//     }

//     // Update all selected batches to include this student
//     const updateBatchesPromises = batchIds.map(batchId => {
//       return Batch.findByIdAndUpdate(
//         batchId,
//         {
//           $addToSet: { assignedStudents: studentId },
//           $inc: { remainingStudentCount: -1 }
//         },
//         { new: true }
//       );
//     });

//     // Execute all batch updates
//     const updatedBatches = await Promise.all(updateBatchesPromises);

//     // Extract batch subjects to update the registration with assigned subjects
//     const allAssignedSubjects = [];
//     updatedBatches.forEach(batch => {
//       if (batch.subject && batch.subject.length > 0) {
//         batch.subject.forEach(subjectItem => {
//           const subjectId = typeof subjectItem.subject === 'object'
//             ? subjectItem.subject._id
//             : subjectItem.subject;

//           if (!allAssignedSubjects.includes(subjectId)) {
//             allAssignedSubjects.push(subjectId);
//           }
//         });
//       }
//     });

//     // Update registration with assigned batches info if needed
//     // This is optional based on your data model - you might want to track
//     // which batches a student is assigned to in their registration record
//     await Registration.findByIdAndUpdate(
//       studentId,
//       {
//         $set: {
//           assignedBatches: batchIds,
//           assignedSubjects: allAssignedSubjects,
//           batchAssignmentDate: new Date()
//         }
//       },
//       { new: true }
//     );

//     res.status(200).json({
//       message: 'Student successfully assigned to multiple batches',
//       batches: updatedBatches.map(batch => ({
//         id: batch._id,
//         name: batch.batchName,
//         remainingSlots: batch.remainingStudentCount
//       }))
//     });

//   } catch (error) {
//     console.error('Error assigning student to multiple batches:', error);
//     res.status(500).json({ error: 'Server error while assigning batches.' });
//   }
// });

// app.post('/api/assign-multiple-batches', async (req, res) => {
//   try {
//     // Add debugging to see what's being received
//     console.log('Request body:', req.body);
//     console.log('Content-Type:', req.headers['content-type']);
    
//     const { studentId, subjectBatchMappings, batchIds } = req.body;
    
//     // Handle both old format (batchIds) and new format (subjectBatchMappings)
//     let finalBatchIds = [];
    
//     if (subjectBatchMappings && Array.isArray(subjectBatchMappings)) {
//       // New format: extract batch IDs from subject-batch mappings
//       finalBatchIds = subjectBatchMappings.map(mapping => mapping.batchId);
//     } else if (batchIds && Array.isArray(batchIds)) {
//       // Old format: use batch IDs directly
//       finalBatchIds = batchIds;
//     }
    
//     // Enhanced validation
//     if (!studentId) {
//       return res.status(400).json({ 
//         error: 'Student ID is required.',
//         received: { studentId, subjectBatchMappings, batchIds }
//       });
//     }
    
//     if (!finalBatchIds || finalBatchIds.length === 0) {
//       return res.status(400).json({ 
//         error: 'At least one batch must be selected.',
//         received: { studentId, subjectBatchMappings, batchIds }
//       });
//     }

//     // Validate student ID format
//     if (!mongoose.Types.ObjectId.isValid(studentId)) {
//       return res.status(400).json({ error: 'Invalid student ID format.' });
//     }

//     // Validate batch IDs format
//     const invalidBatchIds = [];
//     for (const batchId of finalBatchIds) {
//       if (!mongoose.Types.ObjectId.isValid(batchId)) {
//         invalidBatchIds.push(batchId);
//       }
//     }
    
//     if (invalidBatchIds.length > 0) {
//       return res.status(400).json({ 
//         error: 'Invalid batch ID format(s)',
//         invalidIds: invalidBatchIds
//       });
//     }

//     // Remove duplicates
//     const uniqueBatchIds = [...new Set(finalBatchIds)];

//     // Find student registration
//     const registration = await Registration.findById(studentId);
//     if (!registration) {
//       return res.status(404).json({ error: 'Student registration not found.' });
//     }

//     // Find all batches
//     const batches = await Batch.find({ _id: { $in: uniqueBatchIds } }).populate('subject.subject');
//     console.log("Batches found:", batches);
    
//     if (batches.length !== uniqueBatchIds.length) {
//       const foundBatchIds = batches.map(b => b._id.toString());
//       const missingBatchIds = uniqueBatchIds.filter(id => !foundBatchIds.includes(id));
//       return res.status(400).json({ 
//         error: 'One or more selected batches not found.',
//         missingBatchIds
//       });
//     }

//     // Check if student is already assigned to any of these batches
//     const alreadyAssignedBatches = batches.filter(batch => 
//       batch.assignedStudents && batch.assignedStudents.some(id => id.toString() === studentId)
//     );
    
//     if (alreadyAssignedBatches.length > 0) {
//       return res.status(400).json({
//         error: 'Student is already assigned to some of these batches',
//         alreadyAssigned: alreadyAssignedBatches.map(b => ({
//           id: b._id,
//           name: b.batchName
//         }))
//       });
//     }

//     // Check if batches have capacity
//     const fullBatches = batches.filter(batch => batch.remainingStudentCount <= 0);
//     if (fullBatches.length > 0) {
//       return res.status(400).json({
//         error: 'Some batches have no remaining slots',
//         fullBatches: fullBatches.map(b => ({
//           id: b._id,
//           name: b.batchName,
//           remainingSlots: b.remainingStudentCount
//         }))
//       });
//     }

//     // Start a transaction to ensure data consistency
//     const session = await mongoose.startSession();
    
//     try {
//       await session.withTransaction(async () => {
//         // Update all selected batches to include this student
//         const updateBatchesPromises = uniqueBatchIds.map(batchId => {
//           return Batch.findByIdAndUpdate(
//             batchId,
//             {
//               $addToSet: { assignedStudents: studentId },
//               $inc: { remainingStudentCount: -1 }
//             },
//             { new: true, session }
//           );
//         });

//         // Execute all batch updates
//         const updatedBatches = await Promise.all(updateBatchesPromises);

//         // Extract batch subjects to update the registration
//         const allAssignedSubjects = new Set();
//         updatedBatches.forEach(batch => {
//           if (batch.subject && batch.subject.length > 0) {
//             batch.subject.forEach(subjectItem => {
//               const subjectId = typeof subjectItem.subject === 'object'
//                 ? subjectItem.subject._id.toString()
//                 : subjectItem.subject.toString();
              
//               allAssignedSubjects.add(subjectId);
//             });
//           }
//         });

//         // Update registration with assigned batches info
//         const updatedRegistration = await Registration.findByIdAndUpdate(
//           studentId,
//           {
//             $addToSet: { 
//               assignedBatches: { $each: uniqueBatchIds },
//               assignedSubjects: { $each: Array.from(allAssignedSubjects) }
//             },
//             $set: { batchAssignmentDate: new Date() }
//           },
//           { new: true, session }
//         );

//         // Return success response
//         res.status(200).json({
//           message: 'Student successfully assigned to multiple batches',
//           studentId,
//           assignedBatches: updatedBatches.map(batch => ({
//             id: batch._id,
//             name: batch.batchName,
//             remainingSlots: batch.remainingStudentCount,
//             subjects: batch.subject
//           })),
//           assignedSubjects: Array.from(allAssignedSubjects),
//           subjectBatchMappings: subjectBatchMappings || null
//         });
//       });
//     } finally {
//       await session.endSession();
//     }

//   } catch (error) {
//     console.error('Error assigning student to multiple batches:', error);
//     res.status(500).json({ 
//       error: 'Server error while assigning batches.',
//       details: error.message 
//     });
//   }
// });
app.post('/api/assign-multiple-batches', async (req, res) => {
  try {
    // Add debugging to see what's being received
    console.log('Request body:', req.body);
    console.log('Content-Type:', req.headers['content-type']);
    
    const { studentId, subjectBatchMappings, batchIds } = req.body;
    
    // Handle both old format (batchIds) and new format (subjectBatchMappings)
    let finalBatchIds = [];
    
    if (subjectBatchMappings && Array.isArray(subjectBatchMappings)) {
      // New format: extract batch IDs from subject-batch mappings
      finalBatchIds = subjectBatchMappings.map(mapping => mapping.batchId);
    } else if (batchIds && Array.isArray(batchIds)) {
      // Old format: use batch IDs directly
      finalBatchIds = batchIds;
    }
    
    // Enhanced validation
    if (!studentId) {
      return res.status(400).json({ 
        error: 'Student ID is required.',
        received: { studentId, subjectBatchMappings, batchIds }
      });
    }
    
    if (!finalBatchIds || finalBatchIds.length === 0) {
      return res.status(400).json({ 
        error: 'At least one batch must be selected.',
        received: { studentId, subjectBatchMappings, batchIds }
      });
    }

    // Validate student ID format
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({ error: 'Invalid student ID format.' });
    }

    // Validate batch IDs format
    const invalidBatchIds = [];
    for (const batchId of finalBatchIds) {
      if (!mongoose.Types.ObjectId.isValid(batchId)) {
        invalidBatchIds.push(batchId);
      }
    }
    
    if (invalidBatchIds.length > 0) {
      return res.status(400).json({ 
        error: 'Invalid batch ID format(s)',
        invalidIds: invalidBatchIds
      });
    }

    // Remove duplicates
    const uniqueBatchIds = [...new Set(finalBatchIds)];

    // Find student registration
    const registration = await Registration.findById(studentId);
    if (!registration) {
      return res.status(404).json({ error: 'Student registration not found.' });
    }

    // Find all batches
    const batches = await Batch.find({ _id: { $in: uniqueBatchIds } }).populate('subject.subject');
    console.log("Batches found:", batches);
    
    if (batches.length !== uniqueBatchIds.length) {
      const foundBatchIds = batches.map(b => b._id.toString());
      const missingBatchIds = uniqueBatchIds.filter(id => !foundBatchIds.includes(id));
      return res.status(400).json({ 
        error: 'One or more selected batches not found.',
        missingBatchIds
      });
    }

    // Check if student is already assigned to any of these batches
    const alreadyAssignedBatches = batches.filter(batch => 
      batch.assignedStudents && batch.assignedStudents.some(id => id.toString() === studentId)
    );
    
    if (alreadyAssignedBatches.length > 0) {
      return res.status(400).json({
        error: 'Student is already assigned to some of these batches',
        alreadyAssigned: alreadyAssignedBatches.map(b => ({
          id: b._id,
          name: b.batchName
        }))
      });
    }

    // Check if batches have capacity
    const fullBatches = batches.filter(batch => batch.remainingStudentCount <= 0);
    if (fullBatches.length > 0) {
      return res.status(400).json({
        error: 'Some batches have no remaining slots',
        fullBatches: fullBatches.map(b => ({
          id: b._id,
          name: b.batchName,
          remainingSlots: b.remainingStudentCount
        }))
      });
    }

    // Start a transaction to ensure data consistency
    const session = await mongoose.startSession();
    
    try {
      await session.withTransaction(async () => {
        // Update all selected batches to include this student
        const updateBatchesPromises = uniqueBatchIds.map(async (batchId) => {
          // Add the student to the batch and calculate remaining count in one operation
          const updatedBatch = await Batch.findByIdAndUpdate(
            batchId,
            {
              $addToSet: { assignedStudents: studentId }
            },
            { new: true, session }
          );

          // Calculate remaining count: studentCount - number of assigned students
          // Ensure it never goes below 0
          const assignedStudentsCount = updatedBatch.assignedStudents ? updatedBatch.assignedStudents.length : 0;
          const studentCount = updatedBatch.studentCount || 0;
          const remainingCount = Math.max(0, studentCount - assignedStudentsCount);

          // Update the remaining count (will be 0 when batch is full)
          return await Batch.findByIdAndUpdate(
            batchId,
            {
              $set: { remainingStudentCount: remainingCount }
            },
            { new: true, session }
          );
        });

        // Execute all batch updates
        const updatedBatches = await Promise.all(updateBatchesPromises);

        // Extract batch subjects to update the registration
        const allAssignedSubjects = new Set();
        updatedBatches.forEach(batch => {
          if (batch.subject && batch.subject.length > 0) {
            batch.subject.forEach(subjectItem => {
              const subjectId = typeof subjectItem.subject === 'object'
                ? subjectItem.subject._id.toString()
                : subjectItem.subject.toString();
              
              allAssignedSubjects.add(subjectId);
            });
          }
        });

        // Update registration with assigned batches info
        const updatedRegistration = await Registration.findByIdAndUpdate(
          studentId,
          {
            $addToSet: { 
              assignedBatches: { $each: uniqueBatchIds },
              assignedSubjects: { $each: Array.from(allAssignedSubjects) }
            },
            $set: { batchAssignmentDate: new Date() }
          },
          { new: true, session }
        );

        // Return success response
        res.status(200).json({
          message: 'Student successfully assigned to multiple batches',
          studentId,
          assignedBatches: updatedBatches.map(batch => ({
            id: batch._id,
            name: batch.batchName,
            remainingSlots: batch.remainingStudentCount,
            subjects: batch.subject
          })),
          assignedSubjects: Array.from(allAssignedSubjects),
          subjectBatchMappings: subjectBatchMappings || null
        });
      });
    } finally {
      await session.endSession();
    }

  } catch (error) {
    console.error('Error assigning student to multiple batches:', error);
    res.status(500).json({ 
      error: 'Server error while assigning batches.',
      details: error.message 
    });
  }
});

app.post("/api/faculty/by-branches", async (req, res) => {
  try {
    const { branchIds } = req.body;

    if (!branchIds || !Array.isArray(branchIds) || branchIds.length === 0) {
      return res.status(400).json({ message: "Invalid branch IDs" });
    }

    // Fetch faculty members who belong to any of the selected branches
    const faculty = await Faculty.find({
      $or: [
        { branchId: { $in: branchIds } },  // If branchId is stored as string
        { _id: { $in: branchIds.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null).filter(Boolean) } }
      ]
    }).select('_id firstName lastName employeeId email'); // Select only needed fields

    res.json(faculty);
  } catch (error) {
    console.error("Error fetching faculty by branches:", error);
    res.status(500).json({ message: error.message });
  }
});


// API endpoint to fetch batches for multiple faculty IDs
app.post("/api/faculty-batches/multiple", async (req, res) => {
  try {
    const { facultyIds } = req.body;
    console.log("Fetching batches for faculty IDs:", facultyIds);

    if (!facultyIds || !Array.isArray(facultyIds) || facultyIds.length === 0) {
      return res.status(400).json({ message: "Invalid faculty IDs" });
    }

    // Convert string IDs to ObjectIds if needed
    const objectIds = facultyIds.map(id =>
      mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id
    );

    // Find batches where any of the selected faculty members are teaching
    // We need to look in the subject array for matches
    const batches = await Batch.find({
      "subject.faculty": { $in: objectIds }
    });

    // Transform to format expected by frontend
    // We need to extract only the relevant subjects for each faculty
    const batchOptions = [];

    batches.forEach(batch => {
      // Filter subjects taught by the selected faculty
      batch.subject.forEach(subjectItem => {
        // Check if this subject is taught by one of our selected faculty
        if (objectIds.some(id => subjectItem.faculty.toString() === id.toString())) {
          batchOptions.push({
            batchId: batch.batchId,
            batchName: batch.batchName,
            subjectCode: subjectItem.subject, // Using subject as the code
            subjectName: subjectItem.subject, // Using subject as the name too
            day: subjectItem.day,
            timeSlot: subjectItem.timeSlot,
            facultyId: subjectItem.faculty
          });
        }
      });
    });

    res.json(batchOptions);
  } catch (error) {
    console.error("Error fetching batches for multiple faculty:", error);
    res.status(500).json({ message: error.message });
  }
});


// Create announcement (faculty)
app.post("/api/announcements", async (req, res) => {
  console.log("Creating announcement with data:", req.body); // Log the incoming data
  try {
    const { facultyId, branchId, date, batches, announcementName, description } = req.body;

    // Validate required fields
    if (!facultyId || !branchId || !date || !batches || !description) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Create the announcement
    const newAnnouncement = new Announcement({
      facultyId,
      branchId,
      date,
      batches,
      announcementName,
      description
    });

    await newAnnouncement.save();
    res.status(201).json(newAnnouncement);
  } catch (error) {
    console.error("Error creating announcement:", error);
    res.status(500).json({ message: error.message });
  }
});

// Create announcement (admin) - creates multiple announcements, one per faculty
app.post("/api/announcements/admin", async (req, res) => {
  console.log("Creating admin announcements with data:", req.body); // Log the incoming data
  try {
    const { facultyIds, branchIds, date, batches, announcementName, description } = req.body;

    // Validate required fields
    if (!facultyIds || !Array.isArray(facultyIds) || facultyIds.length === 0 ||
      !branchIds || !Array.isArray(branchIds) || branchIds.length === 0 ||
      !date || !batches || !description) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Create an announcement for each faculty member
    const announcements = [];

    for (const facultyId of facultyIds) {
      // Get the faculty's branch ID
      const faculty = await Faculty.findById(facultyId).select('branchId');

      if (faculty) {
        const newAnnouncement = new Announcement({
          facultyId,
          branchId: faculty.branchId, // Use the faculty's actual branch ID
          date,
          batches, // Use the batches selected by the admin
          announcementName,
          description
        });

        await newAnnouncement.save();
        announcements.push(newAnnouncement);
      }
    }

    res.status(201).json({ message: `Created ${announcements.length} announcements`, announcements });
  } catch (error) {
    console.error("Error creating admin announcements:", error);
    res.status(500).json({ message: error.message });
  }
});
app.get('/api/courses/bymasterbranch/:masterBranchId', async (req, res) => {
    try {
        const { masterBranchId } = req.params;

        // Validate that masterBranchId is a valid ObjectId
        if (!mongoose.Types.ObjectId.isValid(masterBranchId)) {
            return res.status(400).json({ message: 'Invalid master branch ID' });
        }

        // Find courses by MasterBranchID
        const courses = await Course.find({ MasterBranchID: masterBranchId });

        if (!courses || courses.length === 0) {
            return res.status(404).json({ message: 'No courses found for this master branch' });
        }

        res.json(courses);
    } catch (error) {
        console.error('Error fetching courses by master branch:', error);
        res.status(500).json({ message: 'Error fetching courses', error: error.message });
    }
});
app.post('/api/branches/receipt-info', async (req, res) => {
  try {
    console.log("Received request to fetch branch receipt info:", req.body); // Log the incoming request
    const { masterBranchId, branchId } = req.body;

    // Validate input
    if (!masterBranchId || !branchId) {
      return res.status(400).json({
        success: false,
        message: 'Both masterBranchId and branchId are required'
      });
    }

    // Fetch master branch information
    const masterBranch = await MasterBranch.findById(masterBranchId);
    if (!masterBranch) {
      return res.status(404).json({
        success: false,
        message: `Master branch not found with ID: ${masterBranchId}`
      });
    }

    // Fetch specific branch information
    const branch = await Branch.findOne({ branchId: branchId });
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: `Branch not found with ID: ${branchId}`
      });
    }

    // Return the branch information
    res.json({
      success: true,
      data: {
        masterBranchName: masterBranch.MasterBranchName,
        branch: {
          branchId: branch.branchId,
          branchName: branch.branchName,
          location: branch.location,
          email: branch.email,
          phone: branch.phone,
          fulladdress: branch.fulladdress,
          createdAt: branch.createdAt
        }
      }
    });

  } catch (error) {
    console.error('Error fetching branch information:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching branch information',
      error: error.message
    });
  }
});

// 1. API to fetch assigned students
app.get('/api/assigned-students', async (req, res) => {
  try {
    const assignedBatches = await Batch.find({
      assignedStudents: { $exists: true, $ne: [] },
      status: { $ne: 'cancelled' } // optional filter if needed
    })
    .populate({
      path: 'assignedStudents',
      match: { regStatus: "Approved" },  // Only include approved students
    })
    .populate({
      path: 'subject.faculty',
      model: 'Faculty'
    })
    .populate('faculty') // batch-level faculty if exists
    .lean();

    console.log("Batches with assigned students:", assignedBatches.length);
    res.status(200).json(assignedBatches);
  } catch (error) {
    console.error('Error fetching batches with assigned students:', error);
    res.status(500).json({ 
      error: 'Server error while fetching batches.',
      details: error.message 
    });
  }
});



// 2. API to remove student from specific batch
app.delete('/api/remove-student-from-batch/:studentId/:batchId', async (req, res) => {
  try {
    const { studentId, batchId } = req.params;

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(studentId) || !mongoose.Types.ObjectId.isValid(batchId)) {
      return res.status(400).json({ error: 'Invalid student ID or batch ID.' });
    }

    // Fetch the batch
    const batch = await Batch.findById(batchId);

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found.' });
    }

    // Check if student is assigned to this batch
    if (!batch.assignedStudents.includes(studentId)) {
      return res.status(400).json({ error: 'Student is not assigned to this batch.' });
    }

    // Remove the student from assignedStudents and increment remainingStudentCount
    await Batch.findByIdAndUpdate(
      batchId,
      {
        $pull: { assignedStudents: studentId },
        $inc: { remainingStudentCount: 1 }
      }
    );

    res.status(200).json({
      message: 'Student removed from batch successfully',
      studentId,
      batchId
    });
  } catch (error) {
    console.error('Error removing student from batch:', error);
    res.status(500).json({ 
      error: 'Server error while removing student from batch.',
      details: error.message 
    });
  }
});


// 3. API to update student's batch assignments
app.put('/api/update-student-batches/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { batchIds } = req.body;

    // Validate student ID
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({ error: 'Invalid student ID format.' });
    }

    // Validate batch IDs
    if (!Array.isArray(batchIds)) {
      return res.status(400).json({ error: 'Batch IDs must be an array.' });
    }

    const invalidBatchIds = batchIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidBatchIds.length > 0) {
      return res.status(400).json({ 
        error: 'Invalid batch ID format(s)',
        invalidIds: invalidBatchIds
      });
    }

    // Find student and current batches
    const student = await Registration.findById(studentId);
    if (!student) {
      return res.status(404).json({ error: 'Student not found.' });
    }

    const currentBatchIds = student.assignedBatches || [];
    const newBatchIds = [...new Set(batchIds)]; // Remove duplicates

    // Find batches to add and remove
    const batchesToAdd = newBatchIds.filter(id => !currentBatchIds.includes(id));
    const batchesToRemove = currentBatchIds.filter(id => !newBatchIds.includes(id));

    console.log('Batches to add:', batchesToAdd);
    console.log('Batches to remove:', batchesToRemove);

    // Validate new batches exist and have capacity
    if (batchesToAdd.length > 0) {
      const newBatches = await Batch.find({ _id: { $in: batchesToAdd } });
      
      if (newBatches.length !== batchesToAdd.length) {
        return res.status(400).json({ error: 'Some selected batches not found.' });
      }

      const fullBatches = newBatches.filter(batch => batch.remainingStudentCount <= 0);
      if (fullBatches.length > 0) {
        return res.status(400).json({
          error: 'Some batches have no remaining slots',
          fullBatches: fullBatches.map(b => ({
            id: b._id,
            name: b.batchName,
            remainingSlots: b.remainingStudentCount
          }))
        });
      }
    }

    // Start transaction
    const session = await mongoose.startSession();
    
    try {
      await session.withTransaction(async () => {
        // Remove student from old batches
        if (batchesToRemove.length > 0) {
          await Batch.updateMany(
            { _id: { $in: batchesToRemove } },
            {
              $pull: { assignedStudents: studentId },
              $inc: { remainingStudentCount: 1 }
            },
            { session }
          );
        }

        // Add student to new batches
        if (batchesToAdd.length > 0) {
          await Batch.updateMany(
            { _id: { $in: batchesToAdd } },
            {
              $addToSet: { assignedStudents: studentId },
              $inc: { remainingStudentCount: -1 }
            },
            { session }
          );
        }

        // Update student's assigned batches
        await Registration.findByIdAndUpdate(
          studentId,
          {
            $set: { assignedBatches: newBatchIds }
          },
          { session }
        );

        // Update assigned subjects based on new batches
        const allBatches = await Batch.find({ _id: { $in: newBatchIds } }).session(session);
        const allAssignedSubjects = new Set();
        
        allBatches.forEach(batch => {
          if (batch.subject && batch.subject.length > 0) {
            batch.subject.forEach(subjectItem => {
              const subjectId = typeof subjectItem.subject === 'object'
                ? subjectItem.subject._id.toString()
                : subjectItem.subject.toString();
              allAssignedSubjects.add(subjectId);
            });
          }
        });

        await Registration.findByIdAndUpdate(
          studentId,
          {
            $set: { assignedSubjects: Array.from(allAssignedSubjects) }
          },
          { session }
        );
      });

      res.status(200).json({
        message: 'Student batch assignments updated successfully',
        studentId,
        newBatchIds,
        batchesAdded: batchesToAdd.length,
        batchesRemoved: batchesToRemove.length
      });

    } finally {
      await session.endSession();
    }

  } catch (error) {
    console.error('Error updating student batches:', error);
    res.status(500).json({ 
      error: 'Server error while updating student batches.',
      details: error.message 
    });
  }
});


// Add this API endpoint to your index.js file

// API to get registered students based on batch subjects
// app.get('/api/batches/:batchId/registered-students', async (req, res) => {
//   try {
//     const { batchId } = req.params;
//     console.log("batch", req.params)
    
//     // Step 1: Fetch the batch and its subjects
//     const batch = await Batch.findById(batchId).populate('subject.faculty');
//     if (!batch) {
//       return res.status(404).json({ message: 'Batch not found' });
//     }

//     // Extract subject codes from batch
//     const batchSubjects = batch.subject.map(s => s.subject);
    
//     if (batchSubjects.length === 0) {
//       return res.json({ registeredStudents: [] });
//     }

//     // Step 2: Get ObjectIds for these subjects from Subject schema
//     const subjectObjects = await Subject.find({ 
//       SubjectId: { $in: batchSubjects } 
//     }).select('_id SubjectId SubjectName');

//     const subjectObjectIds = subjectObjects.map(s => s._id);

//     // Step 3: Find registrations that have these subjects in their selectedSubjects
//     const registrations = await Registration.find({
//       selectedSubjects: { $in: subjectObjectIds },
//       regStatus: 'Approved' // Only get approved registrations
//     }).populate('selectedSubjects', 'SubjectId SubjectName')
//      .populate('courseId', 'courseName')
//      .populate('courseTypeId', 'courseTypeName')
//      .populate('masterBranchId', 'branchName');

//     // Step 4: Filter out students who are already assigned to this batch
//     const alreadyAssignedStudents = batch.assignedStudents.map(id => id.toString());
    
//     const availableStudents = registrations.filter(reg => 
//       !alreadyAssignedStudents.includes(reg._id.toString())
//     );

//     // Step 5: Format the response with required student information
//     const formattedStudents = availableStudents.map(student => ({
//       _id: student._id,
//       regid: student.regid,
//       fullName: `${student.fName} ${student.lName}`,
//       fName: student.fName,
//       lName: student.lName,
//       email: student.email,
//       phone: student.phone,
//       courseName: student.courseName,
//       courseType: student.courseTypeId?.courseTypeName || '',
//       course: student.courseId?.courseName || '',
//       masterBranch: student.masterBranchId?.branchName || '',
//       joiningDate: student.joiningDate,
//       selectedSubjects: student.selectedSubjects,
//       matchingSubjects: student.selectedSubjects.filter(subject => 
//         batchSubjects.includes(subject.SubjectId)
//       ),
//       totalPaid: student.totalPaid,
//       remainingAmount: student.remainingAmount,
//       regStatus: student.regStatus,
//       formStatus: student.formStatus
//     }));
//  console.log("stdd",formattedStudents)
//     res.json({
//       success: true,
//       batchInfo: {
//         batchId: batch.batchId,
//         batchName: batch.batchName,
//         subjects: batchSubjects,
//         currentlyAssigned: batch.assignedStudents.length,
//         remainingCapacity: batch.studentCount - batch.assignedStudents.length
//       },
//       registeredStudents: formattedStudents,
//       totalAvailable: formattedStudents.length
//     });

//   } catch (error) {
//     console.error('Error fetching registered students:', error);
//     res.status(500).json({ 
//       success: false, 
//       message: 'Error fetching registered students',
//       error: error.message 
//     });
//   }
// });
app.get('/api/batches/:batchId/registered-students', async (req, res) => {
  try {
    const { batchId } = req.params;
    console.log("batch", req.params);
    
    // Step 1: Fetch the batch and its subjects
    const batch = await Batch.findById(batchId).populate('subject.faculty');
    if (!batch) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    // Extract subject codes from batch
    const batchSubjects = batch.subject.map(s => s.subject);
    
    if (batchSubjects.length === 0) {
      return res.json({ 
        success: true,
        registeredStudents: [],
        assignedStudents: [],
        totalAvailable: 0 
      });
    }

    // Step 2: Get ObjectIds for these subjects from Subject schema
    const subjectObjects = await Subject.find({
      SubjectId: { $in: batchSubjects }
    }).select('_id SubjectId SubjectName');

    const subjectObjectIds = subjectObjects.map(s => s._id);

    // Step 3: Find registrations that have these subjects in their selectedSubjects
    const registrations = await Registration.find({
      selectedSubjects: { $in: subjectObjectIds },
      regStatus: 'Approved' // Only get approved registrations
    }).populate('selectedSubjects', 'SubjectId SubjectName')
     .populate('courseId', 'courseName')
     .populate('courseTypeId', 'courseTypeName')
     .populate('masterBranchId', 'branchName');

    // Step 4: Separate assigned and available students
    const assignedStudentIds = batch.assignedStudents.map(id => id.toString());
    
    const assignedStudents = registrations.filter(reg =>
      assignedStudentIds.includes(reg._id.toString())
    );
    
    const availableStudents = registrations.filter(reg =>
      !assignedStudentIds.includes(reg._id.toString())
    );

    // Step 5: Format both assigned and available students
    const formatStudent = (student) => ({
      _id: student._id,
      regid: student.regid,
      fullName: `${student.fName} ${student.lName}`,
      fName: student.fName,
      lName: student.lName,
      email: student.email,
      phone: student.phone,
      courseName: student.courseName,
      courseType: student.courseTypeId?.courseTypeName || '',
      course: student.courseId?.courseName || '',
      masterBranch: student.masterBranchId?.branchName || '',
      joiningDate: student.joiningDate,
      selectedSubjects: student.selectedSubjects,
      matchingSubjects: student.selectedSubjects.filter(subject =>
        batchSubjects.includes(subject.SubjectId)
      ),
      totalPaid: student.totalPaid,
      remainingAmount: student.remainingAmount,
      regStatus: student.regStatus,
      formStatus: student.formStatus
    });

    const formattedAssignedStudents = assignedStudents.map(formatStudent);
    const formattedAvailableStudents = availableStudents.map(formatStudent);
    
    // Combine both lists for display
    const allStudents = [
      ...formattedAssignedStudents.map(student => ({ ...student, isAssigned: true })),
      ...formattedAvailableStudents.map(student => ({ ...student, isAssigned: false }))
    ];

    console.log("All students:", allStudents);

    res.json({
      success: true,
      batchInfo: {
        batchId: batch.batchId,
        batchName: batch.batchName,
        subjects: batchSubjects,
        currentlyAssigned: batch.assignedStudents.length,
        remainingCapacity: batch.studentCount - batch.assignedStudents.length
      },
      registeredStudents: allStudents, // All students (assigned + available)
      assignedStudents: formattedAssignedStudents, // Currently assigned
      availableStudents: formattedAvailableStudents, // Available to assign
      totalAvailable: formattedAvailableStudents.length,
      totalAssigned: formattedAssignedStudents.length
    });

  } catch (error) {
    console.error('Error fetching registered students:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching registered students',
      error: error.message
    });
  }
});
// API to assign students to batch
app.post('/api/batches/:batchId/assign-students', async (req, res) => {
  try {
    const { batchId } = req.params;
    const { studentIds } = req.body;

    if (!studentIds || !Array.isArray(studentIds)) {
      return res.status(400).json({ message: 'Student IDs array is required' });
    }

    // Find the batch
    const batch = await Batch.findById(batchId);
    if (!batch) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    // Check if batch has capacity
    const currentAssigned = batch.assignedStudents.length;
    const newAssignments = studentIds.length;
    const totalAfterAssignment = currentAssigned + newAssignments;

    if (totalAfterAssignment > batch.studentCount) {
      return res.status(400).json({ 
        message: `Cannot assign ${newAssignments} students. Batch capacity: ${batch.studentCount}, Currently assigned: ${currentAssigned}` 
      });
    }

    // Verify all students exist and are not already assigned
    const existingStudents = await Registration.find({
      _id: { $in: studentIds },
      regStatus: 'Approved'
    });

    if (existingStudents.length !== studentIds.length) {
      return res.status(400).json({ message: 'Some students not found or not approved' });
    }

    // Check for already assigned students
    const alreadyAssigned = studentIds.filter(id => 
      batch.assignedStudents.includes(id)
    );

    if (alreadyAssigned.length > 0) {
      return res.status(400).json({ 
        message: 'Some students are already assigned to this batch' 
      });
    }

    // Add students to batch
    batch.assignedStudents.push(...studentIds);
    batch.remainingStudentCount = batch.studentCount - batch.assignedStudents.length;
    
    await batch.save();

    res.json({
      success: true,
      message: `Successfully assigned ${studentIds.length} students to batch`,
      batchInfo: {
        batchId: batch.batchId,
        batchName: batch.batchName,
        totalAssigned: batch.assignedStudents.length,
        remainingCapacity: batch.remainingStudentCount
      }
    });

  } catch (error) {
    console.error('Error assigning students to batch:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error assigning students to batch',
      error: error.message 
    });
  }
});

// API to remove students from batch
app.post('/api/batches/:batchId/remove-students', async (req, res) => {
  try {
    const { batchId } = req.params;
    const { studentIds } = req.body;

    if (!studentIds || !Array.isArray(studentIds)) {
      return res.status(400).json({ message: 'Student IDs array is required' });
    }

    // Find the batch
    const batch = await Batch.findById(batchId);
    if (!batch) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    // Remove students from batch
    batch.assignedStudents = batch.assignedStudents.filter(id => 
      !studentIds.includes(id.toString())
    );
    batch.remainingStudentCount = batch.studentCount - batch.assignedStudents.length;
    
    await batch.save();

    res.json({
      success: true,
      message: `Successfully removed ${studentIds.length} students from batch`,
      batchInfo: {
        batchId: batch.batchId,
        batchName: batch.batchName,
        totalAssigned: batch.assignedStudents.length,
        remainingCapacity: batch.remainingStudentCount
      }
    });

  } catch (error) {
    console.error('Error removing students from batch:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error removing students from batch',
      error: error.message 
    });
  }
});
// Add these routes to your backend (Express.js)

app.get('/api/job/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        console.log("Fetching job details for ID:", jobId);
        // Validate if jobId is a valid MongoDB ObjectId
        if (!jobId.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid job ID format' 
            });
        }

        // Assuming you're using MongoDB with Mongoose
        // Replace 'Job' with your actual job model name
        const job = await JobRequirement.findById(jobId);
        
        if (!job) {
            return res.status(404).json({ 
                success: false, 
                message: 'Job not found' 
            });
        }

        // Filter out jobs with "jbk" in company name (as per your existing filter)
        // if (job.companyName && job.companyName.toLowerCase().includes("jbk")) {
        //     return res.status(404).json({ 
        //         success: false, 
        //         message: 'Job not found' 
        //     });
        // }

        res.status(200).json(job);
    } catch (error) {
        console.error('Error fetching job details:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});



// app.get('/api/faculty-performance', authenticateToken, async (req, res) => {
//   try {
//     // Fetch all faculty members with role 'Faculty'
//     const facultyQuery = { role: { $in: ['Faculty'] } };
//     if (isSubAdminUser(req.user) && req.user.branchId) {
//       facultyQuery.branchId = req.user.branchId;
//     }
//     const faculties = await Faculty.find(facultyQuery).populate('MasterBranchID', 'branchName');

//     const performanceData = [];

//     for (const faculty of faculties) {
//       // Calculate average rating from feedbacks
//       let totalRating = 0;
//       let feedbackCount = 0;

//       if (faculty.Feedbacks && faculty.Feedbacks.length > 0) {
//         faculty.Feedbacks.forEach(feedback => {
//           if (feedback.rating && !isNaN(parseFloat(feedback.rating))) {
//             totalRating += parseFloat(feedback.rating);
//             feedbackCount++;
//           }
//         });
//       }

//       const averageRating = feedbackCount > 0 ? (totalRating / feedbackCount).toFixed(2) : 0;

//       // Collect subject-wise ratings
//       const subjectRatings = {};
//       if (faculty.Feedbacks && faculty.Feedbacks.length > 0) {
//         faculty.Feedbacks.forEach(feedback => {
//           if (feedback.subject && feedback.rating && !isNaN(parseFloat(feedback.rating))) {
//             if (!subjectRatings[feedback.subject]) {
//               subjectRatings[feedback.subject] = { total: 0, count: 0 };
//             }
//             subjectRatings[feedback.subject].total += parseFloat(feedback.rating);
//             subjectRatings[feedback.subject].count++;
//           }
//         });
//       }

//       // Calculate subject-wise averages
//       const subjects = Object.keys(subjectRatings).map(subject => ({
//         subject,
//         average: (subjectRatings[subject].total / subjectRatings[subject].count).toFixed(2)
//       }));

//       performanceData.push({
//         facultyId: faculty._id,
//         employeeId: faculty.employeeId,
//         firstName: faculty.firstName,
//         lastName: faculty.lastName,
//         department: faculty.department,
//         branchName: faculty.MasterBranchID?.branchName || 'N/A',
//         totalFeedbacks: feedbackCount,
//         averageRating: parseFloat(averageRating),
//         subjects: subjects,
//         experience: faculty.experience || 0,
//         joinDate: faculty.joinDate
//       });
//     }

//     // Sort by average rating (highest first)
//     performanceData.sort((a, b) => b.averageRating - a.averageRating);

//     res.json({
//       success: true,
//       data: performanceData,
//       totalFaculties: performanceData.length
//     });

//   } catch (error) {
//     console.error('Error fetching faculty performance:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching faculty performance data',
//       error: error.message
//     });
//   }
// });


//UPDATED
app.get('/api/faculty-performance', async (req, res) => {

  try {

    // Fetch all faculty members with role 'Faculty'
    const faculties = await Faculty.find({
      role: { $in: ['Faculty'] }
    }).populate('MasterBranchID', 'MasterBranchName');

    console.log("TOTAL FACULTIES:", faculties.length);

    const performanceData = [];

    for (const faculty of faculties) {

      // Calculate average rating from feedbacks
      let totalRating = 0;
      let feedbackCount = 0;

      if (
        faculty.Feedbacks &&
        faculty.Feedbacks.length > 0
      ) {

        faculty.Feedbacks.forEach((feedback) => {

          if (
            feedback.rating &&
            !isNaN(parseFloat(feedback.rating))
          ) {

            totalRating += parseFloat(feedback.rating);
            feedbackCount++;

          }

        });

      }

      const averageRating =
        feedbackCount > 0
          ? (
              totalRating / feedbackCount
            ).toFixed(2)
          : 0;

      // Subject-wise ratings
      const subjectRatings = {};

      if (
        faculty.Feedbacks &&
        faculty.Feedbacks.length > 0
      ) {

        faculty.Feedbacks.forEach((feedback) => {

          if (
            feedback.subject &&
            feedback.rating &&
            !isNaN(parseFloat(feedback.rating))
          ) {

            if (!subjectRatings[feedback.subject]) {

              subjectRatings[feedback.subject] = {
                total: 0,
                count: 0,
              };

            }

            subjectRatings[feedback.subject].total +=
              parseFloat(feedback.rating);

            subjectRatings[feedback.subject].count++;

          }

        });

      }

      // Calculate subject averages
      const subjects = Object.keys(subjectRatings).map(
        (subject) => ({

          subject,

          average: (
            subjectRatings[subject].total /
            subjectRatings[subject].count
          ).toFixed(2),

        })
      );

      performanceData.push({

        facultyId: faculty._id,

        employeeId: faculty.employeeId || "N/A",

        firstName: faculty.firstName || "",

        lastName: faculty.lastName || "",

        department: faculty.department || "N/A",

        branchName:
          faculty.MasterBranchID?.MasterBranchName ||
          "N/A",

        totalFeedbacks: feedbackCount,

        averageRating: parseFloat(averageRating),

        subjects,

        experience: faculty.experience || 0,

        joinDate: faculty.joinDate || null,

      });

    }

    // Sort highest rating first
    performanceData.sort(
      (a, b) => b.averageRating - a.averageRating
    );

    res.json({
      success: true,
      data: performanceData,
      totalFaculties: performanceData.length,
    });

  } catch (error) {

    console.error(
      'Error fetching faculty performance:',
      error
    );

    res.status(500).json({

      success: false,

      message:
        'Error fetching faculty performance data',

      error: error.message,

    });

  }

});

// app.get('/api/faculty-performance/:facultyId', authenticateToken, async (req, res) => {
//   try {
//     const { facultyId } = req.params;

//     const faculty = await Faculty.findById(facultyId)
//       .populate('MasterBranchID', 'branchName')
//       .populate('Feedbacks.studentId', 'firstName lastName');

//     if (!faculty) {
//       return res.status(404).json({
//         success: false,
//         message: 'Faculty not found'
//       });
//     }

//     if (
//       isSubAdminUser(req.user) &&
//       req.user.branchId &&
//       faculty.branchId !== req.user.branchId
//     ) {
//       return res.status(403).json({
//         success: false,
//         message: "Access denied for this branch",
//       });
//     }

//     // Calculate detailed analytics
//     const feedbacks = faculty.Feedbacks || [];
//     const totalFeedbacks = feedbacks.length;
    
//     let totalRating = 0;
//     let ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
//     const courseWiseRatings = {};
//     const subjectWiseRatings = {};
//     const monthlyRatings = {};

//     feedbacks.forEach(feedback => {
//       if (feedback.rating && !isNaN(parseFloat(feedback.rating))) {
//         const rating = parseFloat(feedback.rating);
//         totalRating += rating;
        
//         // Rating distribution
//         const roundedRating = Math.round(rating);
//         if (roundedRating >= 1 && roundedRating <= 5) {
//           ratingDistribution[roundedRating]++;
//         }

//         // Course-wise ratings
//         if (feedback.course) {
//           if (!courseWiseRatings[feedback.course]) {
//             courseWiseRatings[feedback.course] = { total: 0, count: 0 };
//           }
//           courseWiseRatings[feedback.course].total += rating;
//           courseWiseRatings[feedback.course].count++;
//         }

//         // Subject-wise ratings
//         if (feedback.subject) {
//           if (!subjectWiseRatings[feedback.subject]) {
//             subjectWiseRatings[feedback.subject] = { total: 0, count: 0 };
//           }
//           subjectWiseRatings[feedback.subject].total += rating;
//           subjectWiseRatings[feedback.subject].count++;
//         }
//       }
//     });

//     const averageRating = totalFeedbacks > 0 ? (totalRating / totalFeedbacks).toFixed(2) : 0;

//     res.json({
//       success: true,
//       data: {
//         faculty: {
//           _id: faculty._id,
//           employeeId: faculty.employeeId,
//           firstName: faculty.firstName,
//           lastName: faculty.lastName,
//           department: faculty.department,
//           branchName: faculty.MasterBranchID?.branchName || 'N/A'
//         },
//         analytics: {
//           totalFeedbacks,
//           averageRating: parseFloat(averageRating),
//           ratingDistribution,
//           courseWiseRatings: Object.keys(courseWiseRatings).map(course => ({
//             course,
//             average: (courseWiseRatings[course].total / courseWiseRatings[course].count).toFixed(2),
//             count: courseWiseRatings[course].count
//           })),
//           subjectWiseRatings: Object.keys(subjectWiseRatings).map(subject => ({
//             subject,
//             average: (subjectWiseRatings[subject].total / subjectWiseRatings[subject].count).toFixed(2),
//             count: subjectWiseRatings[subject].count
//           }))
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching faculty detail performance:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching faculty performance details',
//       error: error.message
//     });
//   }
// });


//UPDATED
app.get('/api/faculty-performance/:facultyId', async (req, res) => {

  try {

    const { facultyId } = req.params;

    console.log("FACULTY ID:", facultyId);

    const faculty = await Faculty.findById(facultyId)
      .populate('MasterBranchID', 'MasterBranchName')
      .populate('Feedbacks.studentId', 'firstName lastName');

    if (!faculty) {

      return res.status(404).json({
        success: false,
        message: 'Faculty not found'
      });

    }

    // Detailed analytics
    const feedbacks = faculty.Feedbacks || [];

    const totalFeedbacks = feedbacks.length;

    let totalRating = 0;

    let ratingDistribution = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0
    };

    const courseWiseRatings = {};

    const subjectWiseRatings = {};

    feedbacks.forEach((feedback) => {

      if (
        feedback.rating &&
        !isNaN(parseFloat(feedback.rating))
      ) {

        const rating = parseFloat(feedback.rating);

        totalRating += rating;

        // Rating Distribution
        const roundedRating = Math.round(rating);

        if (
          roundedRating >= 1 &&
          roundedRating <= 5
        ) {

          ratingDistribution[roundedRating]++;

        }

        // Course Wise
        if (feedback.course) {

          if (!courseWiseRatings[feedback.course]) {

            courseWiseRatings[feedback.course] = {
              total: 0,
              count: 0
            };

          }

          courseWiseRatings[feedback.course].total += rating;

          courseWiseRatings[feedback.course].count++;

        }

        // Subject Wise
        if (feedback.subject) {

          if (!subjectWiseRatings[feedback.subject]) {

            subjectWiseRatings[feedback.subject] = {
              total: 0,
              count: 0
            };

          }

          subjectWiseRatings[feedback.subject].total += rating;

          subjectWiseRatings[feedback.subject].count++;

        }

      }

    });

    const averageRating =
      totalFeedbacks > 0
        ? (
            totalRating / totalFeedbacks
          ).toFixed(2)
        : 0;

    res.json({

      success: true,

      data: {

        faculty: {

          _id: faculty._id,

          employeeId:
            faculty.employeeId || "N/A",

          firstName:
            faculty.firstName || "",

          lastName:
            faculty.lastName || "",

          department:
            faculty.department || "N/A",

          branchName:
            faculty.MasterBranchID?.MasterBranchName ||
            "N/A",

          experience:
            faculty.experience || 0,

          joinDate:
            faculty.joinDate || null,

        },

        analytics: {

          totalFeedbacks,

          averageRating:
            parseFloat(averageRating),

          ratingDistribution,

          courseWiseRatings:
            Object.keys(courseWiseRatings).map(
              (course) => ({

                course,

                average: (
                  courseWiseRatings[course].total /
                  courseWiseRatings[course].count
                ).toFixed(2),

                count:
                  courseWiseRatings[course].count,

              })
            ),

          subjectWiseRatings:
            Object.keys(subjectWiseRatings).map(
              (subject) => ({

                subject,

                average: (
                  subjectWiseRatings[subject].total /
                  subjectWiseRatings[subject].count
                ).toFixed(2),

                count:
                  subjectWiseRatings[subject].count,

              })
            ),

          recentFeedbacks: feedbacks
            .slice(-10)
            .reverse(),

        },

      },

    });

  } catch (error) {

    console.error(
      'Error fetching faculty detail performance:',
      error
    );

    res.status(500).json({

      success: false,

      message:
        'Error fetching faculty performance details',

      error: error.message,

    });

  }

});

app.use(express.static(path.join(__dirname, 'dist')));

// Route all other requests to serve 'index.html' for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});


// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});