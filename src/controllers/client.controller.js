import Client from "../models/client.model.js";

// create a new client

export const createClient = async (req,res) => {


    try {

        const { clientName, clientEmail, industry, monthlyBudget } = req.body;


        const newClient = await Client.create({
            clientName,
            clientEmail,
            industry,
            monthlyBudget
        });

        if(!newClient){
            return  res.status(400).json({ error: "Failed to create client" });
        }

        console.log("New client created:", newClient);

        res.status(201).json(newClient);

        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}


// get all clients

export const getAllClients = async (req,res) => {
    try {
        const clients = await Client.find();
        res.status(200).json(clients);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch clients" });
    }
}