import mongoose from "mongoose";

const clientSchema = new mongoose.Schema({
    clientName:{
        type: String,
        required: true
    },
    clientEmail:{
        type: String,
        trim: true,
        lowercase: true,
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
       platformConnections: {
      type: [
        {
          name: {
            type: String,
            enum: [
              "Google",
              "Meta",
              "LinkedIn",
              "X",
            ],
          },
          status: {
            type: String,
            enum: ["Connected", "Pending", "Not Connected"],
            default: "Not Connected",
          },
          connectedAt: { type: Date },
        },
      ],
      default: () => [
        { name: "Google", status: "Not Connected" },
        { name: "Meta", status: "Not Connected" },
        { name: "LinkedIn", status: "Not Connected" },
        { name: "X", status: "Not Connected" },
      ],
    },
    },{timestamps:true}
);


const Client=mongoose.model("Client",clientSchema);

export default Client;
    