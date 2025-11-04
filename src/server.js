
import dotenv from 'dotenv';
import app from './app.js';


dotenv.config();



const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`[dotenv] env loaded`);
  console.log(`Server is running on port ${PORT}`);
});


