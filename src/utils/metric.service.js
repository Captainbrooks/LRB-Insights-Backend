import metricsModel from "../models/metrics.model.js";

export async function saveMetrics(list){
    if(!Array.isArray(list)) return;

    if(list.length === 0) return;

    await metricsModel.insertMany(list);
}