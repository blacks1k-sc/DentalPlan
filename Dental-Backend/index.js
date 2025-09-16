const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const session = require('express-session');
const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const FormData = require('form-data');
const jwtSecretKey = "AgpDental"
// Keep axios for non-stream routes if used elsewhere, but DO NOT use it for SSE proxying.
// Native fetch (Node 18+) supports streaming bodies.
// If your Node is <18, install node-fetch and use it here.
// const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const axios = require('axios');
const compression = require('compression');
const polyclip = require('polygon-clipping')
const { v4: uuidv4 } = require('uuid');
const jobResults = new Map();


const calculateOverlap = (segA, segB) => {
    // Convert segmentation arrays to proper format
    const polygonA = segA.map(point => [point.x, point.y]);
    const polygonB = segB.map(point => [point.x, point.y]);

    // Calculate intersection area
    const intersection = polyclip.intersection([polygonA], [polygonB]);

    if (intersection.length === 0) return 0; // No overlap

    // Calculate the overlapping area using Shoelace formula
    return intersection.reduce((area, poly) => area + polygonArea(poly[0]), 0);
}

// Shoelace formula to calculate the area of a polygon
const polygonArea = (points) => {
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % n]; // Wrap around for last point
        area += x1 * y2 - x2 * y1;
    }
    return Math.abs(area / 2);
}
// const { createCanvas, loadImage } = require('canvas');
// const sharp = require('sharp')
const app = express();
const upload = multer({ dest: 'AnnotatedFiles/', storage: multer.memoryStorage() });

// Session configuration for streaming auth
app.use(session({
    secret: process.env.SESSION_SECRET || 'dental-streaming-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true in production with HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'
    },
    name: 'dental.session'
}));

// CORS configuration with credentials support
const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:3001',
            'https://agp-dental-dental.mdbgo.io',
            'https://agp-ui-dental.mdbgo.io',
            'https://agp_ui-dental.mdbgo.io'
        ];
        
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true, // Enable credentials for cookies
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
    exposedHeaders: ['New-Token']
};

// Global compression EXCEPT for /api/chat_stream to avoid buffering SSE
app.use((req, res, next) => {
  if (req.path === '/api/chat_stream') return next();
  return compression()(req, res, next);
});

app.use(cors(corsOptions));

// Disable compression for streaming routes
app.use((req, res, next) => {
    if (req.path.includes('/chat_stream') || req.path.includes('/setup-stream')) {
        res.set({
            'X-Accel-Buffering': 'no', // Disable nginx buffering
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
    }
    req.setTimeout(300000);
    res.setTimeout(300000);
    next();
});

app.use(express.json({ limit: '10000mb' }));
app.use(express.urlencoded({ limit: '10000mb', extended: true }));
async function connectToDatabase() {
    try {
        await mongoose.connect('mongodb://agp-ui_agp:Dental%40123@mongo.db.mdbgo.com:8604/agp-ui_agpui', {
        });
        console.log('Connected to the database');
    } catch (error) {
        console.error('Error connecting to the database:', error);
    }
}
connectToDatabase();


const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    
    // Allow test token for local development
    if (authHeader && (authHeader.includes('test-token') || authHeader.includes('Bearer test-token'))) {
        req.user = { id: 'test_user_123' };
        return next();
    }
    
    if (!authHeader) {
        return res.status(403).json({ message: 'No token provided.' });
    }

    // Extract token from "Bearer <token>" format
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (!token) {
        return res.status(403).json({ message: 'Invalid token format.' });
    }

    jwt.verify(token, jwtSecretKey, (err, decoded) => {
        if (err) {
            return res.status(401).json({ message: 'Failed to authenticate token.' });
        }
        const inactivityPeriod = Date.now() - decoded.lastActivity;
        if (inactivityPeriod > 7200000) {
            return res.status(401).json({
                message: 'Token expired due to inactivity.',
                error: 'INACTIVITY_TIMEOUT'
            });
        }

        // Update lastActivity in token
        const newToken = jwt.sign({
            id: decoded.id,
            lastActivity: Date.now()
        }, jwtSecretKey, {
            expiresIn: '24h'
        });
        // Send new token in response header
        res.setHeader('New-Token', newToken);
        req.user = decoded;
        next();
    });
};

const TreatmentCodesSchema = new mongoose.Schema({
    anomaly: {
        type: String,
        required: true,
    },
    treatment_codes: {
        type: Array,
        required: true,
    }
}, {
    collection: "TreatmentCodes"
})
const TreatmentCodes = new mongoose.model('treatmentCodes', TreatmentCodesSchema)

const PracticeListSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    address: {
        type: String,
        required: true,
    },
    contactNo: {
        type: String,
        required: true,
    },
    client_id: {
        type: String,
        required: true,
    }
}, {
    collection: "PracticeList"
})
const PracticeList = new mongoose.model('practiceList', PracticeListSchema)
const PatientSchema = new mongoose.Schema({
    first_name: {
        type: String,
        required: true,
    },
    last_name: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
    },
    telephone: {
        type: String,
        required: true,
    },
    gender: {
        type: String,
        required: true,
    },
    date_of_birth: {
        type: String,
        required: false,
    },
    reference_dob_for_age: {
        type: String,
        required: false,
    },
    guardian_first_name: {
        type: String,
        required: false,
    },
    guardian_last_name: {
        type: String,
        required: false,
    },
    guardian_relationship: {
        type: String,
        required: false,
    },
    address: {
        type: String,
        required: true,
    },
    is_active: {
        type: Boolean,
        required: true,
    },
    created_on: {
        type: String,
        required: true,
    },
    created_by: {
        type: String,
        required: true,
    },
    modified_on: {
        type: String,
        required: false,
    },
    modified_by: {
        type: String,
        required: false,
    },
    practiceId: {
        type: String,
        required: true,
    },
    patient_active: {
        type: Boolean,
        required: true,
    }
}, {
    collection: "Patient"
})
const Patient = new mongoose.model('patient', PatientSchema)
const ClassNameSchema = new mongoose.Schema({
    className: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: false,
    },
    category: {
        type: String,
        required: true,
    },
    color: {
        type: String,
        required: true,
    },
    yt_url1: {
        type: String,
        required: false,
    },
    yt_url2: {
        type: String,
        required: false,
    },
    thumbnail1: {
        type: String,
        required: false,
    },
    thumbnail2: {
        type: String,
        required: false,
    },
    created_on: {
        type: String,
        required: true,
    },
    created_by: {
        type: String,
        required: true,
    },
    modified_on: {
        type: String,
        required: false,
    },
    modified_by: {
        type: String,
        required: false,
    },
    is_deleted: {
        type: Boolean,
        required: true,
    },
    clientId: {
        type: String,
        required: true,
    },
    confidence: {
        type: Number,
        required: true,
    },
    // Group-specific confidence levels
    pano_confidence: {
        type: Number,
        required: false
    },
    bitewing_confidence: {
        type: Number,
        required: false
    },
    pariapical_confidence: {
        type: Number,
        required: false
    },
    ceph_confidence: {
        type: Number,
        required: false
    },
    intraoral_confidence: {
        type: Number,
        required: false
    }
}, {
    collection: 'ClassNames'
})
const ClassName = new mongoose.model('className', ClassNameSchema)
const PatientVisitSchema = new mongoose.Schema({
    patientId: {
        type: String,
        required: true,
    },
    date_of_xray: {
        type: String,
        required: true,
    },
    notes: {
        type: String,
        required: false,
    },
    date_of_visit: {
        type: String,
        required: true,
    },
    summary: {
        type: String,
        required: false,
    },
    created_on: {
        type: String,
        required: true,
    },
    created_by: {
        type: String,
        required: true,
    }
}, {
    collection: "PatientVisits"
})
const PatientVisits = new mongoose.model('patientVisits', PatientVisitSchema)

const PatientImagesSchema = new mongoose.Schema({
    visitId: {
        type: String,
        required: true,
    },
    patientId: {
        type: String,
        required: true,
    },
    image_url: {
        type: String,
        required: true,
    },
    json_url: {
        type: String,
        required: true,
    },
    thumbnail_url: {
        type: String,
        required: true,
    },
    is_deleted: {
        type: Boolean,
        required: true,
    }
}, {
    collection: "PatientImages"
})
const PatientImages = new mongoose.model('patientImages', PatientImagesSchema)

const CDTCodesSchema = new mongoose.Schema({
    "Procedure Code": {
        type: String,
        required: true,
    },
    "Description of Service": {
        type: String,
        required: true,
    },
    "Average Fee": {
        type: Number,
        required: true,
    },
    "Patient Discount": {
        type: Number,
        required: true,
    },
    "Unit": {
        type: String,
        required: true,
    }
}, {
    collection: "CDTCodes"
})
const CDTCodes = new mongoose.model('CDTCodes', CDTCodesSchema)

const TreatmentPlanSchema = new mongoose.Schema({
    patientId: {
        type: String,
        required: true,
    },
    treatments: {
        type: Array,
        required: true,
    },
    created_by: {
        type: String,
        required: true
    },
    created_on: {
        type: String,
        required: true
    },
    updated_on: {
        type: Date,
        required: false
    }
}, {
    collection: "TreatmentPlan"
});

const TreatmentPlan = mongoose.model('TreatmentPlan', TreatmentPlanSchema);
const AnomalyPrerequisitesSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    requisites: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    }
}, {
    collection: "AnomalyRequisites"
});

const AnomalyPrerequisites = mongoose.model('AnomalyPrerequisites', AnomalyPrerequisitesSchema);
// Add this schema to your index.js file after other schemas
const ChatHistorySchema = new mongoose.Schema({
    patientId: {
        type: String,
        required: true,
    },
    visitId: {
        type: String,
        required: true,
    },
    messages: [{
        text: {
            type: String,
            required: true
        },
        sender: {
            type: String,
            required: true,
        },
        timestamp: {
            type: Date,
            default: Date.now
        },
        isError: {
            type: Boolean,
            default: false
        }
    }],
    created_by: {
        type: String,
        required: true,
    },
    created_on: {
        type: Date,
        default: Date.now
    },
    updated_on: {
        type: Date,
        default: Date.now
    }
}, {
    collection: "ChatHistory"
});

const ChatHistory = mongoose.model('ChatHistory', ChatHistorySchema);

// Add these API endpoints to your index.js file

// Save chat message
app.post('/save-chat-message', verifyToken, async (req, res) => {
    try {
        const { patientId, visitId, message } = req.body;

        if (!patientId || !message) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: patientId and message are required'
            });
        }

        let chatHistory;
        
        if (visitId) {
            // Try to find chat history for specific visit first
            chatHistory = await ChatHistory.findOne({ patientId, visitId });
            
            // If no visit-specific history found, try to find patient-only history (for backward compatibility)
            if (!chatHistory) {
                chatHistory = await ChatHistory.findOne({ patientId, visitId: { $exists: false } });
                
                // If we found old-style history, migrate it to include visitId
                if (chatHistory) {
                    console.log(`Migrating old chat history for patient ${patientId} to include visitId ${visitId}`);
                    chatHistory.visitId = visitId;
                }
            }
        } else {
            // Fallback to patient-only history (for backward compatibility)
            chatHistory = await ChatHistory.findOne({ patientId, visitId: { $exists: false } });
        }

        if (chatHistory) {
            // Add message to existing history
            chatHistory.messages.push({
                text: message.text,
                sender: message.sender,
                timestamp: new Date(),
                isError: message.isError || false
            });
            chatHistory.updated_on = new Date();
        } else {
            // Create new chat history
            chatHistory = new ChatHistory({
                patientId,
                visitId: visitId || 'legacy', // Use 'legacy' if no visitId provided
                messages: [{
                    text: message.text,
                    sender: message.sender,
                    timestamp: new Date(),
                    isError: message.isError || false
                }],
                created_by: req.user.id, // From JWT token
                created_on: new Date(),
                updated_on: new Date()
            });
        }

        await chatHistory.save();

        res.json({
            success: true,
            message: 'Chat message saved successfully'
        });
    } catch (error) {
        console.error('Error saving chat message:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// Get chat history for a specific patient visit
app.get('/get-chat-history', verifyToken, async (req, res) => {
    try {
        const { patientId, visitId } = req.query;

        if (!patientId) {
            return res.status(400).json({
                success: false,
                message: 'Patient ID is required'
            });
        }

        let chatHistory;
        
        if (visitId) {
            // Try to find chat history for specific visit first
            chatHistory = await ChatHistory.findOne({ patientId, visitId });
            
            // If no visit-specific history found, try to find patient-only history (for backward compatibility)
            if (!chatHistory) {
                chatHistory = await ChatHistory.findOne({ patientId, visitId: { $exists: false } });
                
                // If we found old-style history, migrate it to include visitId
                if (chatHistory) {
                    console.log(`Migrating old chat history for patient ${patientId} to include visitId ${visitId}`);
                    chatHistory.visitId = visitId;
                    await chatHistory.save();
                }
            }
        } else {
            // Fallback to patient-only history (for backward compatibility)
            chatHistory = await ChatHistory.findOne({ patientId, visitId: { $exists: false } });
        }

        if (!chatHistory) {
            return res.json({
                success: true,
                messages: [],
                message: 'No chat history found for this patient'
            });
        }

        res.json({
            success: true,
            messages: chatHistory.messages
        });
    } catch (error) {
        console.error('Error fetching chat history:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// Clear chat history for a specific patient visit (POST method)
app.post('/clear-chat-history', verifyToken, async (req, res) => {
    try {
        const { patientId, visitId } = req.body;

        if (!patientId) {
            return res.status(400).json({
                success: false,
                message: 'Patient ID is required'
            });
        }

        let deleteResult;
        if (visitId) {
            // Clear specific visit history
            deleteResult = await ChatHistory.findOneAndDelete({ patientId, visitId });
            if (!deleteResult) {
                // Try to clear old-style history for backward compatibility
                deleteResult = await ChatHistory.findOneAndDelete({ patientId, visitId: { $exists: false } });
            }
        } else {
            // Clear all patient history (for backward compatibility)
            deleteResult = await ChatHistory.findOneAndDelete({ patientId, visitId: { $exists: false } });
        }

        res.json({
            success: true,
            message: visitId ? 'Chat history cleared successfully for this visit' : 'Chat history cleared successfully for this patient'
        });
    } catch (error) {
        console.error('Error clearing chat history:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// Clear chat history for a specific patient visit (DELETE method - RESTful alternative)
app.delete('/clear-chat-history', verifyToken, async (req, res) => {
    try {
        const { patientId, visitId } = req.body;

        if (!patientId) {
            return res.status(400).json({
                success: false,
                message: 'Patient ID is required'
            });
        }

        let deleteResult;
        if (visitId) {
            // Clear specific visit history
            deleteResult = await ChatHistory.findOneAndDelete({ patientId, visitId });
            if (!deleteResult) {
                // Try to clear old-style history for backward compatibility
                deleteResult = await ChatHistory.findOneAndDelete({ patientId, visitId: { $exists: false } });
            }
        } else {
            // Clear all patient history (for backward compatibility)
            deleteResult = await ChatHistory.findOneAndDelete({ patientId, visitId: { $exists: false } });
        }

        res.json({
            success: true,
            message: visitId ? 'Chat history cleared successfully for this visit' : 'Chat history cleared successfully for this patient'
        });
    } catch (error) {
        console.error('Error clearing chat history:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});
app.get('/get-anomaly-prerequisites', verifyToken, async (req, res) => {
    try {
        const user1 = await AnomalyPrerequisites.findOne({ name: req.query.name.toLowerCase() })
        res.status(200).json({ user1 })
    }
    catch (err) {
        console.log(err);
        res.status(500).json({ message: err })
    }
})
app.post('/add-treatment-codes', verifyToken, async (req, res) => {
    try {
        // console.log(req.query.clientId);
        const user1 = new TreatmentCodes({ anomaly: req.body.anomaly, treatment_codes: req.body.treatmentCodes })
        await user1.save()
        res.status(200).json({ user1 })
    }
    catch (err) {
        console.log(err);
        res.status(500).json({ message: err })
    }
})
app.get('/get-treatment-codes', verifyToken, async (req, res) => {
    try {
        // console.log(req.query.clientId);
        const user1 = await TreatmentCodes.find()
        res.status(200).json({ user1 })
    }
    catch (err) {
        console.log(err);
        res.status(500).json({ message: err })
    }
})
app.post('/add-practice', verifyToken, async (req, res) => {
    try {
        // console.log(req.query.clientId);
        const user1 = new PracticeList({ name: req.body.name, address: req.body.address, contactNo: req.body.contactNo, client_id: req.body.clientId })
        await user1.save()
        res.status(200).json({ user1 })
    }
    catch (err) {
        console.log(err);
        res.status(500).json({ message: err })
    }
})

app.post('/edit-practice', verifyToken, async (req, res) => {
    try {
        await PracticeList.findOneAndUpdate({ _id: req.body.practiceId }, { name: req.body.name, address: req.body.address, contactNo: req.body.contactNo, client_id: req.body.clientId })
        const user2 = await PracticeList.findOne({ _id: req.body.practiceId })
        res.status(200).json({ user2 })
    }
    catch (err) {
        console.log(err);
        res.status(500).json({ message: err })
    }
})

app.get('/getPracticeList', verifyToken, async (req, res) => {
    try {
        // console.log(req.query.clientId);
        const practiceList = await PracticeList.find({
            "client_id": req.query.clientId
        })
        res.status(200).json({ practiceList })
    }
    catch (err) {
        res.status(500).json({ message: err })
    }
})
app.get('/getPatient', verifyToken, async (req, res) => {
    try {
        const practiceId = req.query.practiceId;
        const patientList = await Patient.find({
            "is_active": true,
            "practiceId": practiceId
        })
        res.status(200).json({ patientList })
    }
    catch (err) {
        res.status(500).json({ message: err })
    }
})

app.get('/getPatientByID', verifyToken, async (req, res) => {
    try {
        const patientId = req.query.patientId;
        const patientList = await Patient.findOne({
            "is_active": true,
            "_id": patientId
        })
        res.status(200).json({ patientList })
    }
    catch (err) {
        console.log(err)
        res.status(500).json({ message: err })
    }
})
app.post('/edit-className', verifyToken, async (req, res) => {
    try {
        const updateFields = {};

        // Only update group-specific confidence level
        if (req.query.group) {
            const fieldName = `${req.query.group}_confidence`;
            updateFields[fieldName] = req.query.confidence;

            await ClassName.findOneAndUpdate({
                _id: req.query.id
            }, updateFields);

            res.status(200).json({ message: "Saved successfully" })
        } else {
            res.status(400).json({ message: "Group parameter is required" })
        }
    }
    catch (err) {
        console.log(err);
        res.status(500).json({ err });
    }
})
app.post('/add-className', verifyToken, async (req, res) => {
    try {
        const date = new Date();
        const defaultConfidence = 0.00;
        const classDetails = new ClassName({
            "className": req.body.className,
            "description": req.body.description,
            "created_on": date.toUTCString(),
            "created_by": req.body.created_by,
            "category": req.body.category,
            "color": req.body.color,
            "is_deleted": false,
            clientId: req.body.clientId,
            confidence: defaultConfidence, // Keep for backward compatibility
            pano_confidence: defaultConfidence,
            bitewing_confidence: defaultConfidence,
            pariapical_confidence: defaultConfidence,
            ceph_confidence: defaultConfidence,
            intraoral_confidence: defaultConfidence
        })
        await classDetails.save()
        res.status(200).json({ classDetails })
    }
    catch (err) {
        console.log(err);
        res.status(500).json({ err });
    }
})
app.get('/get-classCategories', verifyToken, async (req, res) => {
    try {
        // Fetch all documents and return only the category field
        const classDetails = await ClassName.find(
            {
                is_deleted: false,
                $or: [
                    { clientId: { $exists: false } },
                    { clientId: req.query.clientId }
                ]
            },
            {
                _id: 1,
                category: 1,
                className: 1,
                color: 1,
                confidence: 1,
                pano_confidence: 1,
                bitewing_confidence: 1,
                periapical_confidence: 1,
                ceph_confidence: 1,
                intraoral_confidence: 1
            }
        );
        res.status(200).json(classDetails);
    }
    catch (err) {
        res.status(500).json({ err });
    }
})
app.get('/get-className', verifyToken, async (req, res) => {
    try {
        const classDetails = await ClassName.findOne({
            className: req.query.className, is_deleted: false
        })
        res.status(200).json(classDetails)
    }
    catch (err) {
        res.status(500).json({ err });
    }
})

app.post('/add-patientVisit', verifyToken, async (req, res) => {
    try {

        const date = new Date();
        const visit = new PatientVisits({
            "patientId": req.body.patientId, "date_of_xray": req.body.date_of_xray, "notes": req.body.notes, "date_of_visit": req.body.date_of_visit,
            "summary": req.body.summary, "created_on": date.toUTCString(), "created_by": req.body.created_by
        })
        await visit.save()
        const visitDetail = await PatientVisits.findOne({
            "patientId": req.body.patientId,
            "date_of_visit": req.body.date_of_visit, "created_on": date.toUTCString()
        })
        res.status(200).json({ visitDetail })

    }
    catch (err) {
        console.log(err)
        res.status(500).json({ err })
    }
})

app.post('/update-patientVisit', verifyToken, async (req, res) => {
    try {
        await PatientVisits.findOneAndUpdate({ "_id": req.body.visitId }, {
            $set: {
                "date_of_xray": req.body.date_of_xray,
                "notes": req.body.notes, "date_of_visit": req.body.date_of_visit, "summary": req.body.summary
            }
        })
        return res.status(200).json({ message: "Patient visit updated successfully" });
    }
    catch (err) {
        console.log(err)
        res.status(500).json({ err })
    }
})

app.get('/getVisitDetailsById', verifyToken, async (req, res) => {
    try {
        const visitDetails = await PatientVisits.find({
            "_id": req.query.visitID
        })
        res.status(200).json({ visitDetails })
    }
    catch (err) {
        res.status(500).json({ message: err })
    }
})
//Patient images

app.get('/getPatientVisitsByID', verifyToken, async (req, res) => {
    try {
        const patientId = req.query.patientId;
        const patienVisits = await PatientVisits.find({
            "patientId": patientId
        }).sort({ date_of_visit: -1 })
        res.status(200).json({ patienVisits })
    }
    catch (err) {
        res.status(500).json({ message: err })
    }
})

app.get('/getPatientImagesByID', verifyToken, async (req, res) => {
    try {
        const patientId = req.query.patientId;
        const patienImages = await PatientImages.find({
            "patientId": patientId,
            "is_deleted": false
        })
        res.status(200).json({ patienImages })
    }
    catch (err) {
        res.status(500).json({ message: err })
    }
})

app.post('/delete-patient-image', verifyToken, async (req, res) => {
    try {
        const idsString = req.query.ids;
        const idsArray = idsString.split(',');
        const objectIds = idsArray.map(id => new mongoose.Types.ObjectId(id));

        const filter = { _id: { $in: objectIds } };
        const update = { is_deleted: true };
        const result = await PatientImages.updateMany(filter, update)
        res.status(200).json({
            message: 'Records updated successfully',
            modifiedCount: result.modifiedCount,
        });
    }

    catch (err) {
        console.log(err)
        res.status(500).json({ message: "Internal Server Error" })
    }
})


//----------------
app.get('/next-previousVisit', verifyToken, async (req, res) => {
    try {
        const visitId = req.query.visitId
        const patientId = req.query.patientId;
        const patientVisits = await PatientVisits.find({
            "patientId": patientId
        })
        patientVisits.sort((a, b) => a.date_of_visit - b.date_of_visit);
        const currentVisitIndex = patientVisits.findIndex(visit => visit._id.toString() === visitId);
        if (currentVisitIndex === -1) {
            // console.log(currentVisitIndex)
            return res.status(404).json({ message: 'Visit not found' });
        }
        if (req.query.next === "true") {
            res.status(200).json({ visitId: patientVisits[currentVisitIndex + 1], last: currentVisitIndex + 1 === patientVisits.length - 1 })
        }
        else {
            res.status(200).json({ visitId: patientVisits[currentVisitIndex - 1], first: currentVisitIndex - 1 === 0 })
        }
    }
    catch (err) {
        res.status(500).json({ message: err })
    }
})
app.post('/delete-patient', verifyToken, async (req, res) => {
    try {
        await Patient.findOneAndUpdate({ "email": req.body.email }, { $set: { "is_active": false } })
        res.status(200).json({ message: "Successfully deleted" })
    }
    catch (err) {
        console.log(err)
        res.status(500).json({ err })
    }
})
app.post('/add-patient', verifyToken, async (req, res) => {
    try {
        if (await Patient.findOne({ "email": req.body.email })) {
            res.status(409).json({ message: "Patient already found" })
        }
        else {
            const date = new Date();
            const user = new Patient({
                "first_name": req.body.first_name, "last_name": req.body.last_name, "email": req.body.email, "telephone": req.body.telephone, "gender": req.body.gender,
                "date_of_birth": req.body.dob, "reference_dob_for_age": req.body.reference_dob_for_age, "guardian_first_name": req.body.guardian_first_name,
                "guardian_last_name": req.body.guardian_last_name, "guardian_relationship": req.body.guardian_relationship, "address": req.body.address,
                "is_active": req.body.is_active, "created_on": date.toUTCString(), "created_by": req.body.created_by, "practiceId": req.body.practiceId, "patient_active": req.body.patientActive
            })
            await user.save()
            const user1 = await Patient.findOne({ "email": req.body.email })
            res.status(200).json({ user1 })
        }
    }
    catch (err) {
        console.log(err)
        res.status(500).json({ err })
    }
})
app.post('/edit-patient', verifyToken, async (req, res) => {
    try {
        let date = new Date()
        await Patient.findOneAndUpdate({ _id: req.body.patientId }, {
            $set: {
                "first_name": req.body.first_name, "last_name": req.body.last_name, "email": req.body.email,
                "telephone": req.body.telephone, "gender": req.body.gender, "date_of_birth": req.body.dob, "reference_dob_for_age": req.body.reference_dob_for_age,
                "guardian_first_name": req.body.guardian_first_name, "guardian_last_name": req.body.guardian_last_name, "guardian_relationship": req.body.guardian_relationship,
                "address": req.body.address, "modified_on": date.toUTCString(), "modified_by": req.body.created_by, "patient_active": req.body.patientActive
            }
        });
        const user1 = await Patient.findOne({ _id: req.body.patientId })
        if (user1) {
            res.status(200).json({ user1 });
        } else {
            res.status(404).json({ message: "Item not found" });
        }
    }
    catch (err) {
        console.log(err)
        res.status(500).json({ err })
    }
})
app.post('/save-treatment-plan', verifyToken, async (req, res) => {
    try {
        const { patientId, treatments } = req.body;

        if (!patientId || !treatments) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Check if a treatment plan already exists for this patient
        let treatmentPlan = await TreatmentPlan.findOne({ patientId });
        const date = new Date()
        if (treatmentPlan) {
            // Update existing treatment plan
            treatmentPlan.treatments = treatments;
            treatmentPlan.updatedAt = Date.now();
        } else {
            // Create new treatment plan
            treatmentPlan = new TreatmentPlan({
                patientId,
                treatments,
                created_by: req.body.created_by, // Assuming your auth middleware sets user
                created_on: date.toUTCString()
            });
        }

        await treatmentPlan.save();

        res.json({
            success: true,
            message: 'Treatment plan saved successfully',
            treatmentPlan
        });
    } catch (error) {
        console.error('Error saving treatment plan:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// Route to get a treatment plan for a patient
app.get('/get-treatment-plan', verifyToken, async (req, res) => {
    try {
        const patientId = req.query.patientId;

        if (!patientId) {
            return res.status(400).json({
                success: false,
                message: 'Patient ID is required'
            });
        }

        const treatmentPlan = await TreatmentPlan.findOne({ patientId });

        if (!treatmentPlan) {
            return res.json({
                success: true,
                message: 'No treatment plan found for this patient',
                treatmentPlan: null
            });
        }

        res.json({
            success: true,
            treatmentPlan
        });
    } catch (error) {
        console.error('Error fetching treatment plan:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});
// Helper function to check if a label contains tooth numbers
const isToothNumberLabel = (label) => {
    // Check if label contains numbers (tooth numbers like "tooth 1", "tooth 12", etc.)
    const toothPattern = /tooth\s*\d+|^\d+$|tooth/i;
    return toothPattern.test(label);
};

// Helper function to filter JSON annotations
const filterJsonAnnotations = (jsonData) => {
    try {
        const parsed = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
        
        if (parsed.annotations && parsed.annotations.annotations) {
            const filteredAnnotations = parsed.annotations.annotations
                .filter(annotation => !isToothNumberLabel(annotation.label))
                .map(annotation => {
                    const { bounding_box, segmentation, ...filteredAnnotation } = annotation;
                    return filteredAnnotation;
                });
            
            return {
                ...parsed,
                annotations: {
                    ...parsed.annotations,
                    annotations: filteredAnnotations
                }
            };
        }
        
        return parsed;
    } catch (error) {
        console.error('Error filtering JSON:', error);
        return jsonData; // Return original if parsing fails
    }
};

// Helper function to get patient history with filtered JSONs
const getPatientHistory = async (patientId) => {
    try {
        // Get all visits for the patient
        const visits = await PatientVisits.find({ patientId }).sort({ date_of_visit: -1 });
        
        const patientHistory = [];
        
        for (const visit of visits) {
            // Get all images for this visit that are not deleted
            const images = await PatientImages.find({ 
                visitId: visit._id.toString(),
                is_deleted: false 
            });
            
            const visitData = {
                visitId: visit._id,
                date_of_visit: visit.date_of_visit,
                date_of_xray: visit.date_of_xray,
                notes: visit.notes,
                summary: visit.summary,
                images: []
            };
            
            // Process each image's JSON
            for (const image of images) {
                if (image.json_url) {
                    try {
                        // Check if file exists before trying to read it
                        const fullPath = path.join(__dirname, image.json_url);
                        if (fs.existsSync(fullPath)) {
                            const jsonContent = await readJsonFile(image.json_url);
                            const filteredJson = filterJsonAnnotations(jsonContent);
                            
                            visitData.images.push({
                                imageId: image._id,
                                image_url: image.image_url,
                                thumbnail_url: image.thumbnail_url,
                                annotations: filteredJson
                            });
                        } else {
                            console.log(`JSON file not found, skipping: ${image.json_url}`);
                            // Add image without annotations
                            visitData.images.push({
                                imageId: image._id,
                                image_url: image.image_url,
                                thumbnail_url: image.thumbnail_url,
                                annotations: null
                            });
                        }
                    } catch (error) {
                        console.error(`Error processing JSON for image ${image._id}:`, error);
                        // Add image without annotations on error
                        visitData.images.push({
                            imageId: image._id,
                            image_url: image.image_url,
                            thumbnail_url: image.thumbnail_url,
                            annotations: null
                        });
                    }
                }
            }
            
            patientHistory.push(visitData);
        }
        
        return patientHistory;
    } catch (error) {
        console.error('Error getting patient history:', error);
        throw error;
    }
};

// Helper function to read JSON file (implement based on your storage method)
const readJsonFile = async (jsonUrl) => {
    // If files are stored locally
    if (jsonUrl.startsWith('AnnotatedFiles/')) {
        const fullPath = path.join(__dirname, jsonUrl);
        const content = await fs.promises.readFile(fullPath, 'utf8');
        return JSON.parse(content);
    }
    
    // If files are stored in cloud storage or accessible via HTTP
    // Implement your file reading logic here
    // Example for HTTP:
    // const response = await axios.get(jsonUrl);
    // return response.data;
    
    throw new Error('JSON file reading method not implemented');
};



// Function to transform raw annotation data to comprehensive structure with all data types
async function transformAnnotationData(rawData, clientId = null) {
    try {
        console.log('🔍 DEBUG: ===== TRANSFORM ANNOTATION DATA STARTED =====');
        console.log('🔍 DEBUG: Raw data received:', !!rawData);
        console.log('🔍 DEBUG: Images array:', rawData?.images?.length || 0);
        console.log('🔍 DEBUG: Client ID:', clientId);
        
        if (!rawData || !rawData.images || !Array.isArray(rawData.images)) {
            console.log('No images found in raw data');
            return { 
                current_visit: {
                    anomalies: { teeth: [] },
                    procedures: { teeth: [] },
                    foreign_objects: { teeth: [] }
                }
            };
        }

        // Filter out images without annotations
        const validImages = rawData.images.filter(image => 
            image && 
            image.annotations && 
            image.annotations.annotations && 
            image.annotations.annotations.annotations
        );

        if (validImages.length === 0) {
            console.log('No valid images with annotations found');
            return { 
                current_visit: {
                    anomalies: { teeth: [] },
                    procedures: { teeth: [] },
                    foreign_objects: { teeth: [] }
                }
            };
        }

        const anomalyTeethMap = new Map();
        const procedureTeethMap = new Map();
        const foreignObjectTeethMap = new Map();
        
                // Process all annotations and classify them using database
                let totalAnnotations = 0;
                for (const image of validImages) {
                    if (image.annotations && image.annotations.annotations && image.annotations.annotations.annotations) {
                        const annotations = image.annotations.annotations.annotations;
                        totalAnnotations += annotations.length;
                        console.log(`📊 Processing ${annotations.length} annotations from image`);
                        console.log('🔍 DEBUG: Starting annotation processing...');
                        
                        for (const annotation of annotations) {
                    const label = annotation.label;
                    const confidence = annotation.confidence;
                    // For null associatedTooth, use 'unknown' but we'll handle grouping differently
                    const toothNumber = annotation.associatedTooth || 'unknown';
                    
                    if (label) {
                        // Use database-driven classification
                        let category = "Anomaly"; // Default to anomaly
                        try {
                            const checker = await ClassName.findOne({
                                className: { $regex: new RegExp("^" + label + "$", "i") },
                                is_deleted: false,
                                $or: [
                                    { clientId: { $exists: false } },
                                    { clientId: clientId }
                                ]
                            });
                            
                            if (checker) {
                                category = checker.category;
                                console.log(`✅ Found classification: "${label}" -> "${category}" (confidence: ${confidence}, tooth: ${toothNumber})`);
                                console.log(`🔍 DEBUG: Classification details - Label: "${label}", Category: "${category}", Confidence: ${confidence}, Tooth: ${toothNumber}`);
                            } else {
                                console.log(`❌ No classification found for label: "${label}" (clientId: ${clientId}) - using default: Anomaly`);
                                console.log(`🔍 DEBUG: No classification found - Label: "${label}", ClientId: ${clientId}, Using default: Anomaly`);
                            }
                        } catch (dbError) {
                            console.log(`Database lookup failed for label "${label}", defaulting to Anomaly:`, dbError.message);
                        }
                        
                        const isProcedure = category === "Procedure";
                        const isForeignObject = category === "Foreign Object";
                        const isAnomaly = category === "Anomaly";
                        
                        // Process anomalies
                        if (isAnomaly) {
                            // For unknown tooth numbers, create a unique key to avoid grouping different annotations
                            const toothKey = toothNumber === 'unknown' ? 
                                `unknown_${label}_${confidence}_${annotation.created_on}` : 
                                toothNumber;
                            
                            if (!anomalyTeethMap.has(toothKey)) {
                                anomalyTeethMap.set(toothKey, {
                                    number: toothNumber,
                                    anomalies: []
                                });
                            }
                            
                            const anomaly = {
                                description: label,
                                metadata: {
                                    confidence: confidence,
                                    created_by: annotation.created_by,
                                    created_on: annotation.created_on
                                }
                            };
                            
                            anomalyTeethMap.get(toothKey).anomalies.push(anomaly);
                            console.log(`🔍 Added anomaly: "${label}" for tooth ${toothNumber} (confidence: ${confidence}) - Key: ${toothKey}`);
                            console.log(`🔍 DEBUG: Anomaly added to map - Label: "${label}", Tooth: ${toothNumber}, Key: ${toothKey}, Confidence: ${confidence}`);
                        }
                        
                        // Process procedures
                        if (isProcedure) {
                            const toothKey = toothNumber;
                            
                            if (!procedureTeethMap.has(toothKey)) {
                                procedureTeethMap.set(toothKey, {
                                    number: toothNumber,
                                    procedures: []
                                });
                            }
                            
                            const procedure = {
                                description: label,
                                metadata: {
                                    confidence: confidence,
                                    created_by: annotation.created_by,
                                    created_on: annotation.created_on
                                }
                            };
                            
                            procedureTeethMap.get(toothKey).procedures.push(procedure);
                        }
                        
                        // Process foreign objects
                        if (isForeignObject) {
                            const toothKey = toothNumber;
                            
                            if (!foreignObjectTeethMap.has(toothKey)) {
                                foreignObjectTeethMap.set(toothKey, {
                                    number: toothNumber,
                                    foreign_objects: []
                                });
                            }
                            
                            const foreignObject = {
                                description: label,
                                metadata: {
                                    confidence: confidence,
                                    created_by: annotation.created_by,
                                    created_on: annotation.created_on
                                }
                            };
                            
                            foreignObjectTeethMap.get(toothKey).foreign_objects.push(foreignObject);
                        }
                    }
                }
            }
        }
        
        // Convert maps to arrays and sort by tooth number
        const anomalyTeeth = Array.from(anomalyTeethMap.values()).sort((a, b) => a.number - b.number);
        const procedureTeeth = Array.from(procedureTeethMap.values()).sort((a, b) => a.number - b.number);
        const foreignObjectTeeth = Array.from(foreignObjectTeethMap.values()).sort((a, b) => a.number - b.number);
        
                // Debug: Log all anomalies found
                console.log(`\n📊 PROCESSING SUMMARY:`);
                console.log(`Total annotations processed: ${totalAnnotations}`);
                console.log(`\n📊 FINAL ANOMALIES SUMMARY:`);
                anomalyTeeth.forEach(tooth => {
                    console.log(`Tooth ${tooth.number}: ${tooth.anomalies.map(a => a.description).join(', ')}`);
                });
                console.log(`Total anomalies: ${anomalyTeeth.reduce((sum, tooth) => sum + tooth.anomalies.length, 0)}\n`);
                console.log('🔍 DEBUG: ===== TRANSFORMATION COMPLETE =====');
                console.log('🔍 DEBUG: Final anomaly teeth count:', anomalyTeeth.length);
                console.log('🔍 DEBUG: Final procedure teeth count:', procedureTeeth.length);
                console.log('🔍 DEBUG: Final foreign object teeth count:', foreignObjectTeeth.length);
        
        return {
            current_visit: {
                anomalies: { teeth: anomalyTeeth },
                procedures: { teeth: procedureTeeth },
                foreign_objects: { teeth: foreignObjectTeeth }
            }
        };
        
    } catch (error) {
        console.error('Error transforming annotation data:', error);
        return { 
            current_visit: {
                anomalies: { teeth: [] },
                procedures: { teeth: [] },
                foreign_objects: { teeth: [] }
            }
        };
    }
}

app.post('/start-chat-job', verifyToken, async (req, res) => {
    const { query, json, patient_id } = req.body;
    const jobId = uuidv4();

    // Mark job as pending
    jobResults.set(jobId, { status: 'pending', result: null, error: null });

    // Start async task
    (async () => {
        try {
            // Get patient history with filtered JSONs
            const patientHistory = await getPatientHistory(patient_id);
            
            // Transform the raw annotation data to expected structure
            console.log('🔍 DEBUG: About to call transformAnnotationData with patient_id:', patient_id);
            const transformedJson = await transformAnnotationData(json, patient_id);
            console.log('🔍 DEBUG: transformAnnotationData completed');
            console.log('Transformed JSON structure:', JSON.stringify(transformedJson, null, 2));
            
            const requestPayload = { 
                query, 
                json: transformedJson, 
                patient_name: patient_id,
                patient_history: patientHistory
            };
            console.log('Sending to Flask:', JSON.stringify(requestPayload, null, 2));
            
            const flaskResponse = await axios.post(
                `http://127.0.0.1:5001/api/rag-chat`,
                requestPayload,
                {
                    timeout: 600000,
                    headers: {
                        'Connection': 'keep-alive',
                        'Keep-Alive': 'timeout=600'
                    }
                }
            );
            
            // Include both the LLM response and the transformed data for debugging
            const result = {
                ...flaskResponse.data,
                debug_data: {
                    raw_cv_data: json,
                    transformed_llm_data: transformedJson,
                    request_payload: requestPayload
                }
            };
            
            console.log('Setting job result with debug data:', JSON.stringify(result.debug_data, null, 2));
            
            jobResults.set(jobId, { 
                status: 'completed', 
                result: result,
                error: null 
            });
        } catch (error) {
            console.error('Async job error:', error.message);
            console.error('Full error object:', error);
            console.error('Error response data:', error.response?.data);
            console.error('Error response status:', error.response?.status);
            jobResults.set(jobId, {
                status: 'failed',
                result: null,
                error: error.response?.data || error.message || 'Unknown error'
            });
        }
    })();

    res.status(202).json({ jobId });
});
app.get('/chat-job-status/:jobId', verifyToken, (req, res) => {
  const jobId = req.params.jobId;
  const job = jobResults.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  console.log(`Job ${jobId} status:`, job.status);
  if (job.status === 'completed') {
    console.log('Job result has debug_data:', !!job.result?.debug_data);
  }

  res.status(200).json(job);
});
app.post('/chat-with-rag', verifyToken, async (req, res) => {
    try {
        const { query, json } = req.body;

        // Forward request to Flask backend
        const flaskResponse = await axios.post(`http://5.161.242.73/api/rag-chat`, {
            query,
            json
        }, {
            timeout: 600000,
            headers: {
                'Connection': 'keep-alive',
                'Keep-Alive': 'timeout=600'
            },
        }
        );
        console.log(flaskResponse.data)
        // Return response from Flask
        res.status(200).json(flaskResponse.data);
    } catch (error) {
        console.error('Error proxying request to Flask server:', error);

        // Provide appropriate error response
        if (error.response) {
            // Flask server returned an error
            res.status(error.response.status).json({
                error: 'Error from RAG service',
                details: error.response.data
            });
        } else if (error.request) {
            // No response received from Flask server
            res.status(503).json({
                error: 'RAG service unavailable',
                details: 'Could not connect to the RAG service'
            });
        } else {
            // Error in setting up the request
            res.status(500).json({
                error: 'Internal server error',
                details: error.message
            });
        }
    }
});

// Streaming endpoint that pipes SSE from Flask to frontend
app.post('/api/rag-chat-stream', verifyToken, async (req, res) => {
    try {
        const { query, json, patient_id, token } = req.body;
        
        if (!query && !json) {
            return res.status(400).json({ error: 'Query or JSON data required' });
        }

        // Get patient history
        const patientHistory = await getPatientHistory(patient_id);
        
        // Transform annotation data if provided
        let transformedJson = null;
        if (json) {
            // Check if json is already an object or needs parsing
            const jsonData = typeof json === 'string' ? JSON.parse(json) : json;
            transformedJson = await transformAnnotationData(jsonData, patient_id);
        }

        const requestPayload = { 
            query, 
            json: transformedJson, 
            patient_name: patient_id,
            patient_history: patientHistory
        };

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        // Disable buffering
        res.flushHeaders();

        // Forward request to Flask streaming endpoint
        const flaskResponse = await fetch('http://127.0.0.1:5001/api/rag-chat-stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestPayload)
        });

        if (!flaskResponse.ok) {
            res.write(`data: ${JSON.stringify({error: 'Flask server error'})}\n\n`);
            res.end();
            return;
        }

        // Pipe the stream from Flask to client with enhanced logging
        const reader = flaskResponse.body.getReader();
        const decoder = new TextDecoder();
        let chunkCount = 0;
        let totalBytes = 0;
        const startTime = Date.now();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    const duration = Date.now() - startTime;
                    console.log(`📡 Streaming completed. Chunks: ${chunkCount}, Bytes: ${totalBytes}, Duration: ${duration}ms`);
                    break;
                }
                
                const chunk = decoder.decode(value, { stream: true });
                chunkCount++;
                totalBytes += chunk.length;
                
                // Forward chunk to frontend (preserve SSE formatting)
                res.write(chunk);
                res.flush();
                
                // Enhanced logging
                if (chunkCount % 10 === 0) {
                    console.log(`📡 Forwarded ${chunkCount} chunks (${totalBytes} bytes)...`);
                }
                
                // Debug logging for first few chunks
                if (chunkCount <= 3) {
                    console.log(`📦 Chunk ${chunkCount}: ${chunk.substring(0, 100)}${chunk.length > 100 ? '...' : ''}`);
                }
            }
        } catch (streamError) {
            console.error('❌ Stream error:', streamError);
            console.error('❌ Stream error details:', {
                message: streamError.message,
                stack: streamError.stack,
                chunkCount,
                totalBytes
            });
            res.write(`data: ${JSON.stringify({type: 'error', content: 'Streaming error occurred'})}\n\n`);
        } finally {
            res.end();
        }

    } catch (error) {
        console.error('SSE relay error:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        // Set headers if not already set
        if (!res.headersSent) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        }
        
        res.write(`data: ${JSON.stringify({error: error.message, type: 'error'})}\n\n`);
        res.end();
    }
});

// Test SSE endpoint
app.get('/api/test-stream', verifyToken, async (req, res) => {
    try {
        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.flushHeaders();

        // Send test chunks
        for (let i = 0; i < 10; i++) {
            const chunk = `data: ${JSON.stringify({content: `Test chunk ${i+1}`, type: 'test'})}\n\n`;
            res.write(chunk);
            res.flush();
            
            // Wait 0.5 seconds
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        res.write('event: done\ndata: [DONE]\n\n');
        res.end();
        
    } catch (error) {
        console.error('Test stream error:', error);
        res.write(`data: ${JSON.stringify({error: error.message})}\n\n`);
        res.end();
    }
});

app.get('/getCDTCodes', verifyToken, async (req, res) => {
    try {
        const cdtCodes = await CDTCodes.find()
        res.json({ cdtCodes: cdtCodes })
    }
    catch (err) {
        res.status(500).json({ err })
    }
})

app.post("/checkAnomalies", verifyToken, async (req, res) => {
    try {
        const labels = req.body.labels;
        let anomalies = {};

        // Use Promise.all() to execute queries in parallel
        await Promise.all(labels.map(async (label) => {
            const checker = await ClassName.findOne({
                className: { $regex: new RegExp("^" + label + "$", "i") }
            });
            anomalies[label] = checker && checker.category === "Anomaly";
        }));

        res.json(anomalies);
    } catch (err) {
        console.error("Error checking anomalies:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.get('/get-annotations-for-treatment-plan', verifyToken, async (req, res) => {
    try {
        const patientId = req.query.patientId;
        const patientVisits = await PatientVisits.find({
            "patientId": patientId
        }).sort({ date_of_visit: -1 })
        const lastVisit = patientVisits[0]
        const images = await PatientImages.find({ visitId: lastVisit._id.toString(), is_deleted: false });
        // Map through the images and prepare the response for each
        const imageData = await Promise.all(images.map(async (image) => {
            const base64Image = await fs.promises.readFile(image.image_url, 'base64');
            const annotationFilePath = image.image_url.split('.').slice(0, -1).join('.') + '.json';
            const annotationData = await fs.promises.readFile(annotationFilePath, 'utf8');

            return {
                annotations: JSON.parse(annotationData),
            };
        }));
        // Return all images and annotations as an array
        res.json({ images: imageData });
    }
    catch (err) {
        res.status(500).json({ err })
    }
})
app.put('/upload/image-and-annotations', verifyToken, async (req, res) => {
    const { base64Image, thumbnailBase64, fileName, patientID, imageNumber, scaledResponse, annotationFileName, visitId } = req.body;

    // Extract base64 data
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const binaryData = Buffer.from(base64Data, 'base64');

    // Extract thumbnail base64 data
    const thumbnailData = thumbnailBase64.replace(/^data:image\/\w+;base64,/, "");
    const thumbnailBinaryData = Buffer.from(thumbnailData, 'base64');

    const imagePath = path.join(__dirname, 'AnnotatedFiles', fileName);
    const annotationPath = path.join(__dirname, 'AnnotatedFiles', annotationFileName);
    const thumbnailPath = path.join(__dirname, 'AnnotatedFiles', 'Thumbnail', `T${fileName}`);

    try {
        // Save image
        await fs.promises.writeFile(imagePath, binaryData);

        // Save thumbnail
        await fs.promises.writeFile(thumbnailPath, thumbnailBinaryData);

        // Save annotations
        await fs.promises.writeFile(annotationPath, JSON.stringify(scaledResponse));

        // console.log(`Image, thumbnail, and annotations saved for Patient ID: ${patientID}, Image Number: ${imageNumber}`);

        //Save to Database
        const date = new Date();
        const images = new PatientImages({
            "visitId": visitId, "patientId": patientID, "image_url": path.join('AnnotatedFiles', fileName),
            "json_url": path.join('AnnotatedFiles', annotationFileName),
            "thumbnail_url": path.join('AnnotatedFiles', 'Thumbnail', `T${fileName}`), "created_on": date.toUTCString(),
            "is_deleted": false
        })
        await images.save()
        res.status(200).send('Image, thumbnail, and annotations uploaded and saved successfully');
    } catch (err) {
        console.error('Error uploading files:', err);
        res.status(500).send('Error uploading files: ' + err.message);
    }
});

// Helper function to find nearest tooth by centroid distance
function findNearestToothByCentroid(anomaly, toothAnnotations) {
    if (!anomaly.segmentation || anomaly.segmentation.length === 0) {
        return null;
    }

    // Calculate anomaly centroid
    const anomalyCentroid = {
        x: anomaly.segmentation.reduce((sum, point) => sum + point.x, 0) / anomaly.segmentation.length,
        y: anomaly.segmentation.reduce((sum, point) => sum + point.y, 0) / anomaly.segmentation.length
    };

    let nearestTooth = null;
    let minDistance = Infinity;

    for (const toothAnno of toothAnnotations) {
        if (!toothAnno.segmentation || toothAnno.segmentation.length === 0) {
            continue;
        }

        // Calculate tooth centroid
        const toothCentroid = {
            x: toothAnno.segmentation.reduce((sum, point) => sum + point.x, 0) / toothAnno.segmentation.length,
            y: toothAnno.segmentation.reduce((sum, point) => sum + point.y, 0) / toothAnno.segmentation.length
        };

        // Calculate Euclidean distance
        const distance = Math.sqrt(
            Math.pow(anomalyCentroid.x - toothCentroid.x, 2) + 
            Math.pow(anomalyCentroid.y - toothCentroid.y, 2)
        );

        if (distance < minDistance) {
            minDistance = distance;
            nearestTooth = Number.parseInt(toothAnno.label);
        }
    }

    return nearestTooth;
}

// Function to add associatedTooth field to each annotation
function addAssociatedToothToAnnotations(data) {
    if (!data || !data.annotations.annotations || !Array.isArray(data.annotations.annotations)) {
        return data;
    }

    // First, filter out tooth annotations (numeric labels)
    const toothAnnotations = data.annotations.annotations.filter(anno => {
        return !isNaN(Number.parseInt(anno.label)) &&
            Number.parseInt(anno.label) >= 1 &&
            Number.parseInt(anno.label) <= 32;
    });

    // If no tooth annotations found, return original data
    if (toothAnnotations.length === 0) {
        return data;
    }

    // Helper function to find tooth range for bone loss
    const findToothRangeForBoneLoss = (anomaly, toothAnnotations) => {
        const overlappingTeeth = [];

        toothAnnotations.forEach((toothAnno) => {
            const toothNumber = Number.parseInt(toothAnno.label);
            if (
                !isNaN(toothNumber) &&
                toothNumber >= 1 &&
                toothNumber <= 32 &&
                anomaly.segmentation &&
                toothAnno.segmentation
            ) {
                try {
                    const overlap = calculateOverlap(anomaly.segmentation, toothAnno.segmentation);
                    const annoArea = polygonArea(anomaly.segmentation.map((point) => [point.x, point.y]));
                    const overlapPercentage = annoArea > 0 ? overlap / annoArea : 0;

                    // For bone loss, include any tooth with even minimal overlap (2% threshold)
                    if (overlapPercentage > 0.02) {
                        overlappingTeeth.push(toothNumber);
                    }
                } catch (error) {
                    console.error("Error calculating overlap:", error);
                }
            }
        });

        // Sort teeth by number to create a range
        overlappingTeeth.sort((a, b) => a - b);

        if (overlappingTeeth.length > 0) {
            // Format the range as "X-Y" if it's a range, or just "X" if it's a single tooth
            return overlappingTeeth.length > 1
                ? `${overlappingTeeth[0]}-${overlappingTeeth[overlappingTeeth.length - 1]}`
                : `${overlappingTeeth[0]}`;
        }

        return null;
    };

    // Process each annotation to find associated tooth
    const processedAnnotations = data.annotations.annotations.map(anno => {
        // Skip tooth annotations (they don't need an associatedTooth field)
        if (!isNaN(Number.parseInt(anno.label))) {
            return anno;
        }

        let associatedTooth = null;

        // Special handling for bone loss annotations - use the tooth range
        if (anno.label && anno.label.toLowerCase().includes("bone loss")) {
            associatedTooth = findToothRangeForBoneLoss(anno, toothAnnotations);
        }

        // If not bone loss or no range found, use standard single tooth method
        if (!associatedTooth) {
            // Check overlap with each tooth for single tooth association
            let maxOverlap = 0;
            let bestTooth = null;

            // Determine overlap threshold based on anomaly type
            let overlapThreshold = 0.5; // Default threshold for general anomalies
            
            if (anno.label && anno.label.toLowerCase().includes("periapical")) {
                overlapThreshold = 0.05; // Much looser threshold for periapical lesions
            }

            for (const toothAnno of toothAnnotations) {
                // Skip if either annotation doesn't have segmentation
                if (!anno.segmentation || !toothAnno.segmentation) {
                    continue;
                }

                try {
                    // Calculate overlap
                    const overlap = calculateOverlap(anno.segmentation, toothAnno.segmentation);
                    const annoArea = polygonArea(anno.segmentation.map(point => [point.x, point.y]));
                    const overlapPercentage = annoArea > 0 ? overlap / annoArea : 0;

                    // Use dynamic threshold based on anomaly type
                    if (overlapPercentage >= overlapThreshold && overlap > maxOverlap) {
                        maxOverlap = overlap;
                        bestTooth = Number.parseInt(toothAnno.label);
                    }
                } catch (error) {
                    console.error("Error calculating overlap:", error);
                }
            }

            // If we found a tooth above threshold, use it
            if (bestTooth) {
                associatedTooth = bestTooth;
            } else {
                // Fallback: find nearest tooth by centroid distance
                associatedTooth = findNearestToothByCentroid(anno, toothAnnotations);
            }
        }

        // Add associatedTooth field to the annotation
        return {
            ...anno,
            associatedTooth: associatedTooth
        };
    });

    // Return the updated data
    return {
        ...data,
        annotations: {
            ...data.annotations,
            annotations: processedAnnotations
        }
    };
}

// Modified API endpoint
app.post('/upload/coordinates', verifyToken, upload.single('image'), async (req, res) => {
    try {
        const { base64Image, thumbnailBase64, visitId, fileName, patientID, imageNumber, annotationFileName } = req.body
        // console.log(req.body)
        const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
        const fileBuffer = Buffer.from(base64Image.split(',')[1], 'base64');

        // Create FormData
        const formData = new FormData();

        // Append the buffer as a file
        formData.append('image', fileBuffer, {
            filename: 'image.jpg',  // or whatever extension is appropriate
            contentType: 'image/jpeg'  // or appropriate mime type
        });

        // Send to Flask server
        const response = await axios.post('http://5.161.242.73:5000/coordinates',
            formData,
            {
                headers: {
                    ...formData.getHeaders()
                },
                // Add these to handle larger images
                maxBodyLength: Infinity,
                maxContentLength: Infinity
            }
        );

        // Process the response to add associatedTooth field
        const processedData = addAssociatedToothToAnnotations({
            annotations: response.data,
            status: response.data.status
        });
        const scaledResponse = {
            annotations: processedData.annotations,
            status: processedData.status,
        };
        console.log(scaledResponse, processedData)
        const binaryData = Buffer.from(base64Data, 'base64');
        // Extract thumbnail base64 data
        const thumbnailData = thumbnailBase64.replace(/^data:image\/\w+;base64,/, "");
        const thumbnailBinaryData = Buffer.from(thumbnailData, 'base64');
        const imagePath = path.join(__dirname, 'AnnotatedFiles', fileName);
        const annotationPath = path.join(__dirname, 'AnnotatedFiles', annotationFileName);
        const thumbnailPath = path.join(__dirname, 'AnnotatedFiles', 'Thumbnail', `T${fileName}`);
        // Save image
        await fs.promises.writeFile(imagePath, binaryData);
        // Save thumbnail
        await fs.promises.writeFile(thumbnailPath, thumbnailBinaryData);
        // Save annotations (now with associatedTooth field)
        await fs.promises.writeFile(annotationPath, JSON.stringify(scaledResponse));
        // console.log(`Image, thumbnail, and annotations saved for Patient ID: ${patientID}, Image Number: ${imageNumber}`);
        //Save to Database
        const date = new Date();
        const images = new PatientImages({
            "visitId": visitId,
            "patientId": patientID,
            "image_url": path.join('AnnotatedFiles', fileName),
            "json_url": path.join('AnnotatedFiles', annotationFileName),
            "thumbnail_url": path.join('AnnotatedFiles', 'Thumbnail', `T${fileName}`),
            "created_on": date.toUTCString(),
            "is_deleted": false
        })
        await images.save()

        // Return the processed data with associatedTooth fields
        res.status(200).json(processedData.annotations);
    }
    catch (error) {
        console.error('Error forwarding image:', error);
        res.status(500).json({
            error: 'Failed to forward image to Flask server',
            details: error.message
        });
    }
});

app.get('/notes-content', verifyToken, async (req, res) => {
    try {
        const notes = await PatientVisits.findOne({ _id: req.query.visitID })
        if (notes) {
            res.status(200).json({ notes: notes.notes })
        }
        else {
            res.status(404).json({ message: "Visit not found" })
        }
    }
    catch (err) {
        console.log(err)
        res.status(500).json({ message: "Internal Server Error" })
    }
})

app.put('/save-notes', verifyToken, async (req, res) => {
    try {
        const notes = await PatientVisits.findOneAndUpdate({ _id: req.body.visitID }, { notes: req.body.notes })
        if (notes) {
            res.status(200).json({ notes: notes.notes })
        }
        else {
            res.status(404).json({ message: "Visit not found" })
        }
    }

    catch (err) {
        console.log(err)
        res.status(500).json({ message: "Internal Server Error" })
    }
})

app.put('/save-annotations', verifyToken, async (req, res) => {
    const { patientId, visitId, scaledResponse, imageNumber, annotationPath } = req.body;
    const patientImages = await PatientImages.find({
        "patientId": patientId,
        "visitId": visitId
    })
    // let annotationPath = ''
    // patientImages.forEach(element => {
    //     // console.log(imageNumber, element.json_url.split('_')[2])
    //     if (element.json_url.split('_')[2] === imageNumber.toString()) {
    //         annotationPath = element.json_url;
    //         // console.log(annotationPath)
    //     }
    // });
    try {
        if (annotationPath !== '') {
            await fs.promises.writeFile(annotationPath, JSON.stringify(scaledResponse));
            res.status(200).send('Annotations saved successfully');
        }
        else {
            console.error("Unable to find path")
            res.status(404).send("Unable to find path to save")
        }
    } catch (err) {
        console.error('Error uploading files:', err);
        res.status(500).send('Error uploading files: ' + err.message);
    }
})


app.get('/visitid-images', verifyToken, async (req, res) => {
    try {
        const images = await PatientImages.find({ visitId: req.query.visitID, is_deleted: false });
        // Map through the images and prepare the response for each
        const imageData = await Promise.all(images.map(async (image) => {
            const base64Image = await fs.promises.readFile(image.image_url, 'base64');
            const annotationFilePath = image.image_url.split('.').slice(0, -1).join('.') + '.json';
            const annotationData = await fs.promises.readFile(annotationFilePath, 'utf8');

            return {
                image: `data:image/${path.extname(image.image_url).slice(1)};base64,${base64Image}`,
                annotations: JSON.parse(annotationData),
                name: image.image_url
            };
        }));
        // Return all images and annotations as an array
        res.json({ images: imageData });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.get('/visitid-annotations', verifyToken, async (req, res) => {
    try {
        const images = await PatientImages.find({ visitId: req.query.visitID, is_deleted: false });
        // Map through the images and prepare the response for each
        const imageData = await Promise.all(images.map(async (image) => {
            const annotationFilePath = image.image_url.split('.').slice(0, -1).join('.') + '.json';
            const annotationData = await fs.promises.readFile(annotationFilePath, 'utf8');

            return {
                annotations: JSON.parse(annotationData),
                name: image.image_url
            };
        }));
        // Return all images and annotations as an array
        res.json({ images: imageData });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

//User module
app.post('/user-register', async (req, res) => {
    try {
        if (await User.findOne({ "email": req.body.email })) {
            res.status(409).json({ message: "User is already exist" })
        }
        else {
            const pwd = await bcrypt.hash(req.body.password, 10);
            const user = new User({
                "first_name": req.body.first_name, "last_name": req.body.last_name, "email": req.body.email, "role": req.body.role,
                "password": pwd, "client_id": req.body.client_id
            })
            await user.save()
            res.status(200).json({ message: 'User created successfully' })
        }
    }
    catch (err) {
        console.log(err)
        res.status(500).json({ err })
    }
})

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await User.findOne({ "email": username });
        if (!user) return res.status(404).send('User not found');

        // Check password
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return res.status(401).send('Invalid credentials');

        // Generate JWT
        const token = jwt.sign({ id: user._id, lastActivity: Date.now() }, jwtSecretKey, { expiresIn: '12h' });
        const user1 = await User.findOne({ "email": username });
        res.status(200).json({ "token": token, "clientId": user1.client_id, "firstName": user1.first_name, "lastName": user1.last_name });
    } catch (error) {
        res.status(500).send('Server error');
    }
});
//-------------------
app.get('/download-image', verifyToken, (req, res) => {
    const imageName = req.query.imageName; // Get the image file name from the query parameter

    // Define the path to the image in the 'images' folder
    const imagePath = path.join(__dirname, 'AnnotatedFiles', imageName);

    // Set headers to prompt the browser to download the image
    res.setHeader('Content-Disposition', `attachment; filename=${imageName}`);
    res.setHeader('Content-Type', 'image/jpeg'); // You can set this dynamically based on the file type

    // Send the image file to the client
    res.sendFile(imagePath, (err) => {
        if (err) {
            console.error('Error sending file:', err);
            res.status(500).send('Error downloading the image');
        }
    });
});

function serializeError(error) {
    let seen = new Set();
    return JSON.stringify(error, (key, value) => {
        if (typeof value === 'object' && value !== null) {
            // Circular reference check
            if (seen.has(value)) {
                return '[Circular]';
            }
            seen.add(value);
        }
        return value;
    }, 2); // 2 is for indentation level to make the output readable
}
app.post('/log-error', (req, res) => {
    const { error } = req.body; // The full error object
    // Ensure the logs directory exists
    const logDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir);
    }
    const logFilePath = path.join(logDir, 'error.log');
    // Prepare the error log entry
    const timestamp = new Date().toISOString();
    const logMessage = `
      [${timestamp}] ERROR:
      ${serializeError(error)}
      ----------------------------------------------
    `;
    // Append the error message to the log file
    fs.appendFile(logFilePath, logMessage, (err) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to log the error' });
        }
        return res.status(200).json({ message: 'Error logged successfully' });
    });
});

app.use('/AnnotatedFiles/Thumbnail', express.static(path.join(__dirname, 'AnnotatedFiles/Thumbnail')));
app.use('/AnnotatedFiles', express.static(path.join(__dirname, 'AnnotatedFiles')));
// Serve static files from the 'public/images' directory
//app.use('/images', express.static(path.join(__dirname, 'AnnotatedFiles/Thumbnail')));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'dental-backend',
        timestamp: new Date().toISOString(),
        port: 3000
    });
});


// ---- X-RAY UPLOAD -> Flask (/api/xray-upload) ----
app.post("/api/xray-upload", verifyToken, async (req, res) => {
  try {
    let { patientId, visitId, annotationData } = req.body || {};

    if (!patientId || !visitId || annotationData == null) {
      return res.status(400).json({ error: "patientId, visitId, annotationData required" });
    }

    // If frontend sent a string, parse it here
    if (typeof annotationData === "string") {
      try { annotationData = JSON.parse(annotationData); }
      catch (e) { return res.status(400).json({ error: "annotationData invalid JSON" }); }
    }

    // Debug logging
    console.log("[NODE] /api/xray-upload",
      { patientId, visitId, type: typeof annotationData, keys: Object.keys(annotationData || {}) });

    const r = await axios.post(`http://127.0.0.1:5001/api/xray-upload`, {
      patientId, visitId, annotationData
    }, { timeout: 30000 });

    return res.status(r.status).json(r.data);
  } catch (err) {
    console.error("[NODE] /api/xray-upload error:", err?.response?.data || err.message);
    console.error("[NODE] Full error:", err);
    
    // If Flask returned a 400, forward the specific error
    if (err?.response?.status === 400) {
      return res.status(400).json(err.response.data);
    }
    
    return res.status(500).json({ error: err.message });
  }
});

// Ollama health check endpoint
app.get('/health/ollama', async (req, res) => {
    try {
        const healthResponse = await axios.get('http://127.0.0.1:11434/api/tags', {
            timeout: 5000
        });
        
        res.json({
            status: 'healthy',
            ollama: 'connected',
            models: healthResponse.data.models?.length || 0
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy', 
            ollama: 'disconnected',
            error: error.message
        });
    }
});


const server = app.listen(3000, () => console.log('Server running on port 3000'));
server.setTimeout(600000)