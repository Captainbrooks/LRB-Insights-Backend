import mongoose from "mongoose";

const tokenSchema= new mongoose.Schema({
    clientId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Client",
        required:true,
        unique:true // one token document per client
    },
    platform:{
        type:String,
        required:true,
    },
    access_token: String,
    refresh_token: String,
    expiry_date: Number
},{timestamps:true});

export default mongoose.model("Token",tokenSchema);

