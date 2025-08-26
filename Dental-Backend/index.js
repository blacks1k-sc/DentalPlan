const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const FormData = require('form-data');
const jwtSecretKey = "AgpDental"
const axios = require('axios');
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
app.use(function (req, res, next) {
    const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://agp-dental-dental.mdbgo.io',
        'https://agp-ui-dental.mdbgo.io',
        'https://agp_ui-dental.mdbgo.io'
    ];

    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Accept-Encoding, Accept-Language, Connection, Host, Referer, Sec-Ch-Ua, Sec-Ch-Ua-Mobile, Sec-Ch-Ua-Platform, Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site, User-Agent, Authorization");
    res.header("Access-Control-Allow-Methods", "PUT, GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Expose-Headers", "New-Token");
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }
    req.setTimeout(300000); // 300,000 ms = 5 minutes
    res.setTimeout(300000);
    next();
});

app.use(cors())
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
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(403).json({ message: 'No token provided.' });
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
        const { patientId, message } = req.body;

        if (!patientId || !message) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Find existing chat history or create new one
        let chatHistory = await ChatHistory.findOne({ patientId });

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

// Get chat history for a patient
app.get('/get-chat-history', verifyToken, async (req, res) => {
    try {
        const patientId = req.query.patientId;

        if (!patientId) {
            return res.status(400).json({
                success: false,
                message: 'Patient ID is required'
            });
        }

        const chatHistory = await ChatHistory.findOne({ patientId });

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

// Clear chat history for a patient (POST method)
app.post('/clear-chat-history', verifyToken, async (req, res) => {
    try {
        const { patientId } = req.body;

        if (!patientId) {
            return res.status(400).json({
                success: false,
                message: 'Patient ID is required'
            });
        }
        await ChatHistory.findOneAndDelete({ patientId });
        res.json({
            success: true,
            message: 'Chat history cleared successfully'
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

// Clear chat history for a patient (DELETE method - RESTful alternative)
app.delete('/clear-chat-history', verifyToken, async (req, res) => {
    try {
        const { patientId } = req.body;

        if (!patientId) {
            return res.status(400).json({
                success: false,
                message: 'Patient ID is required'
            });
        }
        await ChatHistory.findOneAndDelete({ patientId });
        res.json({
            success: true,
            message: 'Chat history cleared successfully'
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
                        // Read the JSON file (assuming you have access to file system or URL)
                        // This depends on how you're storing/accessing the JSON files
                        const jsonContent = await readJsonFile(image.json_url);
                        const filteredJson = filterJsonAnnotations(jsonContent);
                        
                        visitData.images.push({
                            imageId: image._id,
                            image_url: image.image_url,
                            thumbnail_url: image.thumbnail_url,
                            annotations: filteredJson
                        });
                    } catch (error) {
                        console.error(`Error processing JSON for image ${image._id}:`, error);
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
            
            // Filter the current JSON as well
            const filteredCurrentJson = filterJsonAnnotations(json);
            
            const requestPayload = { 
                query, 
                json: filteredCurrentJson, 
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
            jobResults.set(jobId, { status: 'completed', result: flaskResponse.data, error: null });
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

                    // Only consider if overlap is at least 80%
                    if (overlapPercentage >= 0.8 && overlap > maxOverlap) {
                        maxOverlap = overlap;
                        associatedTooth = Number.parseInt(toothAnno.label);
                    }
                } catch (error) {
                    console.error("Error calculating overlap:", error);
                }
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

const server = app.listen(3000, () => console.log('Server running on port 3000'));
server.setTimeout(600000)