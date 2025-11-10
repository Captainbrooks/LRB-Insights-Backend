import mongoose from "mongoose";

const clientSchema = new mongoose.Schema({
    clientName:{
        type: String,
        required: true
    },
    clientEmail:{
        type: String,
        required: true
    },
    industry:{
        type: String,
        enum:['Technology','E-Commerce','Healthcare','Finance','Retail','Education','Other'],
        required: true
    },
    monthlyBudget:{
        type: Number,
        required: true
    },

    },{timestamps:true}
);


const Client=mongoose.model("Client",clientSchema);

export default Client;
    