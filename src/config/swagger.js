import swaggerUi from "swagger-ui-express";
import swaggerJSDoc from "swagger-jsdoc";

const swaggerDefinition = {
  openapi: "3.0.0",
  info: {
    title: "LRB Insights API",
    version: "1.0.0",
    description: "API documentation for the LRB Insights backend",
  },
  servers: [
    {
      url: "http://localhost:7000",
      description: "Local dev",
    },
  ],
};

const options = {
  definition: swaggerDefinition,
  // Look for JSDoc @openapi blocks inside route files
  apis: ["./src/routes/**/*.js"],
};

const swaggerSpec = swaggerJSDoc(options);

export const swaggerServe = swaggerUi.serve;
export const swaggerSetup = swaggerUi.setup(swaggerSpec, {
  explorer: true,
});
