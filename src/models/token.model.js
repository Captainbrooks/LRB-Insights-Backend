import mongoose from "mongoose";
import { platform } from "os";

const tokenSchema= new mongoose.Schema({
    clientId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Client",
         // one token document per client
    },
    platform:{
        type:String,
        required:true,
    },
    access_token: String,
    refresh_token: String,
    expiry_date: Number
},{timestamps:true});


tokenSchema.index({clientId:1, platform: 1}, {unique:1});

export default mongoose.model("Token",tokenSchema);

