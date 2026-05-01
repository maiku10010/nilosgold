import express, { Request, Response } from 'express';

// 1. Create the Express App (The Waiter)
const app = express();

// 2. Allow the app to read JSON "tickets"
app.use(express.json());

// 3. Create your first "Endpoint" (A menu item)
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'success', 
    message: 'The Goldsmith API is running!' 
  });
});

// 4. Tell the app to listen on a specific port
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});