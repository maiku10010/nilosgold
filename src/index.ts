import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg'; // <-- 1. Import the new Postgres Driver
import { PrismaPg } from '@prisma/adapter-pg'; // <-- 2. Import the Prisma Adapter
import 'dotenv/config';

// 3. Create a connection pool using your Supabase DIRECT_URL
const pool = new Pool({ connectionString: process.env.DIRECT_URL });

// 4. Wrap the pool in the Prisma Adapter
const adapter = new PrismaPg(pool);

// 5. Wake up the Prisma Client and explicitly hand it the adapter!
const prisma = new PrismaClient({ adapter });

const app = express();

app.use(express.json());

//create operation for sales
app.post('/sales', async (req: Request, res: Response) => {
  try{
    const newSales = await prisma.sales.create({
      data: { 
        serviceType: req.body.serviceType,
        price: req.body.price,
        status: req.body.status,
        downpayment: req.body.downpayment || 0.00,
        salesDate: req.body.salesDate ? new Date(req.body.salesDate) : undefined,
        client: {
          connect: { clientId: req.body.clientId }
        }
      }
    });
    res.json(newSales);
  } catch (error) {
    console.error('Error creating sales:', error);
    res.status(500).json({ error: 'Internal Server Error' })}
});
//create operation for inventory
app.post('/inventory', async (req: Request, res: Response) => {
  try {
    const newItem = await prisma.inventory.create({
      data: {
        itemName: req.body.itemName,
        quantity: req.body.quantity,
        unit: req.body.unit
      }
    });
    res.json(newItem);
  } catch (error) {
    console.error('Error creating inventory item:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


//create operation for client
app.post('/client', async (req: Request, res: Response) => {
  try {
    const newClient = await prisma.client.create({
      data: {
        clientName: req.body.clientName,
        contactNum: req.body.contactNum,
        balance: req.body.balance
      }
    });
    res.json(newClient);
  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//create operation for employee
app.post('/employee', async (req: Request, res: Response) => {
  try {
    const newEmployee = await prisma.employee.create({
      data: {
        empName: req.body.empName,
        empRole: req.body.empRole,
        rates: req.body.rates
      }
    })
    res.json(newEmployee);
  } catch (error) {
    console.error('Error creating employee:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//create operation for job_cost
app.post('/job_cost', async (req: Request, res: Response) => {
  try {
    const newJobCost = await prisma.job_Cost.create({
      data: {
        goldUsed: req.body.goldUsed,
        laborCost: req.body.laborCost,
        invoiceId: req.body.invoiceId,
        empId: req.body.empId,
      }
    });
    res.json(newJobCost);
  } catch (error) {
    console.error('Error creating job cost:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//create operation for inquiries
app.post('/inquiries', async (req: Request, res: Response) => {
  try {
    const newInquiry = await prisma.inquiries.create({
      data: {
        customerName: req.body.customerName,
        contactInfo: req.body.contactInfo,
        details: req.body.details,
        category: req.body.category,
        quotedPrice: req.body.quotedPrice,
        status: req.body.status
      }
    });
    res.json(newInquiry);
  } catch (error) {
    console.error('Error creating inquiry:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});



//read operation for sales
app.get('/sales', async (req: Request, res: Response) => {
  try {
    const allSales = await prisma.sales.findMany({include: {client: true}});
    res.json(allSales);
  }
    catch (error) {
      console.error('Error fetching sales:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
});
//read operation for client
app.get('/client', async (req: Request, res: Response) => {
  try {
    const allClients = await prisma.client.findMany({include: {sales: true}});
    res.json(allClients);
  }
    catch (error) {
      console.error('Error fetching clients:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
});
//read operation for inventory
app.get('/inventory', async (req: Request, res: Response) => {
  try {
    const allItems = await prisma.inventory.findMany();
    res.json(allItems);
  }
    catch (error) {
      console.error('Error fetching inventory items:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }  
});
//read operation for employee
app.get('/employee', async (req: Request, res: Response) => { 
  try {
    const allEmployees = await prisma.employee.findMany();
    res.json(allEmployees);
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


//update operation
app.put('/client/:clientId', async (req: Request, res: Response) => { 
  try {
    const targetId = Array.isArray(req.params.clientId) ? req.params.clientId[0] : req.params.clientId;
    const updatedClient = await prisma.client.update({
      where: { clientId: targetId },
      data: {
        clientName: req.body.clientName,
        contactNum: req.body.contactNum,
        balance: req.body.balance,
      }
    });
    res.json(updatedClient);
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running beautifully on http://localhost:${PORT}`);
});