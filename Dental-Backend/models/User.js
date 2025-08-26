const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    first_name: { type: String, required: true },
    last_name: { type: String, required: true },
    email: { type: String, required: true },
    role: { type: String, required: true },
    password: { type: String, required: true },
    client_id:{type: String, required: true},
    is_deleted:{ type: Boolean, required: true,default:false }
  }, {
    collection: "Users"
});

const User = new mongoose.model('users', userSchema)
module.exports = User;