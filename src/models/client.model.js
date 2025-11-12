import mongoose from "mongoose";

const clientSchema = new mongoose.Schema(
  {
    clientName: {
      type: String,
      required: true,
    },
    clientEmail: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
    },
    industry: {
      type: String,
      enum: [
        "Technology",
        "E-Commerce",
        "Healthcare",
        "Finance",
        "Retail",
        "Education",
        "Other",
      ],
      required: true,
    },
    monthlyBudget: {
      type: Number,
      required: true,
    },

    platformConnections: {
      type: [
        {
          name: {
            type: String,
            enum: ["Google", "Meta", "LinkedIn", "X"],
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

    googleAccounts: {
      ga4PropertyId: { type: String, default: null },
      ga4PropertyName: { type: String, default: null },
      googleAdsAccounts: {
    type: [
      {
        id: { type: String, required: true },   // Ads customer ID
        name: { type: String },                 // descriptive name (optional)
        status: { type: String, default: "ACTIVE" },
        type: { type: String, default: "SEARCH" }, // channel type
        currency: { type: String, default: "USD" },
        timeZone: { type: String, default: "America/Toronto" },
      },
    ],
    default: [],
  },
      searchConsoleSite: { type: String, default: null },
      youtubeChannelId: { type: String, default: null },
    },
  },
  { timestamps: true }
);

const Client = mongoose.model("Client", clientSchema);

export default Client;
