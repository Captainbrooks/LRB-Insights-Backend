import mongoose from "mongoose";

const MetricSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, required: true },

  platform: { type: String, required: true }, 
  channel: { type: String, required: true },  

  sourceId: { type: String },       
  sourceName: { type: String },     
  
  metric: { type: String, required: true },
  value: { type: Number, required: true },

  date: { type: Date, required: true },

  meta: { type: Object }            
}, { timestamps: true });

export default mongoose.model("Metric", MetricSchema);
