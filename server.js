require('dotenv').config();
const express = require('express');
const app = express(); // <-- Move this up!
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const http = require('http');
const server = http.createServer(app); // <-- Now app is defined!
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: { origin: '*' }
});

// Middleware
app.use(cors({
  origin: '*'
  // ['http://localhost:3000', 'http://127.0.0.1:3001', 'https://sreerambrahmagnani.github.io/self_order_system-frontend-/']
}));
app.use(express.json());

// Serve images folder as static files
app.use('/images', express.static(path.join(__dirname, 'data', 'images')));

// Configure multer to store images in the "images" folder
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'data', 'images')); // Save in the "images" folder
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname)); // Unique filename with original extension
  },
});

const upload = multer({ storage });

// File paths
const productsFilePath = path.join(__dirname, 'data', 'product.json');
const ordersFilePath = path.join(__dirname, 'data', 'orders.json');

// API to fetch products
app.get('/api/products', (req, res) => {
  fs.readFile(productsFilePath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read products file' });
    }
    res.json(JSON.parse(data));
  });
});

// API to fetch orders
app.get('/api/orders', (req, res) => {
  fs.readFile(ordersFilePath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read orders file' });
    }
    res.json(JSON.parse(data));
  });
});

// API to create a new order
app.post('/api/orders', (req, res) => {
  const newOrder = req.body;
  newOrder.id = Date.now(); // Assign a unique ID
  newOrder.createdAt = new Date().toISOString(); // Add createdAt
  newOrder.pending = true; // Always start as pending

  fs.readFile(ordersFilePath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read orders file' });
    }

    const orders = JSON.parse(data);
    orders.push(newOrder);

    fs.writeFile(ordersFilePath, JSON.stringify(orders, null, 2), (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to write to orders file' });
      }
      io.emit('newOrder', newOrder); // Notify all admins
      res.status(201).json(newOrder);
    });
  });
});

// API to add a new product with image upload
app.post('/api/products', upload.single('image'), (req, res) => {
  const newProduct = JSON.parse(req.body.product); // Parse the product details from the request body
  const imagePath = `/images/${req.file.filename}`; // Path to the uploaded image

  fs.readFile(productsFilePath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read products file' });
    }

    const products = JSON.parse(data);
    newProduct.id = Date.now(); // Assign a unique ID
    newProduct.image = imagePath; // Set the image path
    products.push(newProduct);

    fs.writeFile(productsFilePath, JSON.stringify(products, null, 2), (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to write to products file' });
      }
      notifyMenuUpdate();
      res.status(201).json(newProduct);
    });
  });
});

// API to delete a product
app.delete('/api/products/:id', (req, res) => {
  const productId = parseInt(req.params.id);

  fs.readFile(productsFilePath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read products file' });
    }

    const products = JSON.parse(data);
    const productToDelete = products.find((product) => product.id === productId);

    if (!productToDelete) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Remove the product from the list
    const updatedProducts = products.filter((product) => product.id !== productId);

    // Delete the image file
    const imagePath = path.join(__dirname, 'data', productToDelete.image);
    fs.unlink(imagePath, (unlinkErr) => {
      if (unlinkErr) {
        console.error('Failed to delete image file:', unlinkErr);
        return res.status(500).json({ error: 'Failed to delete image file' });
      }

      // Write the updated product list back to product.json
      fs.writeFile(productsFilePath, JSON.stringify(updatedProducts, null, 2), (writeErr) => {
        if (writeErr) {
          return res.status(500).json({ error: 'Failed to write to products file' });
        }
        notifyMenuUpdate();
        res.status(200).json({ message: 'Product deleted successfully' });
      });
    });
  });
});

// API to toggle product status (enable/disable)
app.patch('/api/products/:id', (req, res) => {
  const productId = parseInt(req.params.id);

  fs.readFile(productsFilePath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read products file' });
    }

    const products = JSON.parse(data);
    const product = products.find((product) => product.id === productId);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    product.enabled = !product.enabled;

    fs.writeFile(productsFilePath, JSON.stringify(products, null, 2), (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to write to products file' });
      }
      notifyMenuUpdate();
      res.status(200).json(product);
    });
  });
});

// API to update a product
app.put('/api/products/:id', upload.single('image'), (req, res) => {
  const productId = parseInt(req.params.id);

  fs.readFile(productsFilePath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read products file' });
    }

    const products = JSON.parse(data);
    const productIndex = products.findIndex((product) => product.id === productId);

    if (productIndex === -1) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const updatedProduct = JSON.parse(req.body.product); // Parse the updated product details
    if (req.file) {
      // If a new image is uploaded, update the image path and delete the old image
      const oldImagePath = path.join(__dirname, 'data', products[productIndex].image);
      fs.unlink(oldImagePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error('Failed to delete old image file:', unlinkErr);
        }
      });
      updatedProduct.image = `/images/${req.file.filename}`;
    } else {
      // Keep the existing image if no new image is uploaded
      updatedProduct.image = products[productIndex].image;
    }

    updatedProduct.id = productId; // Ensure the ID remains the same
    products[productIndex] = updatedProduct;

    fs.writeFile(productsFilePath, JSON.stringify(products, null, 2), (writeErr) => {
      if (writeErr) {
        return res.status(500).json({ error: 'Failed to write to products file' });
      }
      notifyMenuUpdate();
      res.status(200).json(updatedProduct);
    });
  });
});

app.put('/api/orders/:id', (req, res) => {
  const orderId = parseInt(req.params.id);
  fs.readFile(ordersFilePath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read orders file' });
    }
    const orders = JSON.parse(data);
    const orderIndex = orders.findIndex(order => order.id === orderId);
    if (orderIndex === -1) {
      return res.status(404).json({ error: 'Order not found' });
    }
    // Update the pending status
    orders[orderIndex].pending = req.body.pending;
    fs.writeFile(ordersFilePath, JSON.stringify(orders, null, 2), (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to update order' });
      }
      res.json(orders[orderIndex]);
    });
  });
});

app.delete('/api/orders/:id', (req, res) => {
  const orderId = parseInt(req.params.id);
  fs.readFile(ordersFilePath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read orders file' });
    }
    let orders = JSON.parse(data);
    const orderIndex = orders.findIndex(order => order.id === orderId);
    if (orderIndex === -1) {
      return res.status(404).json({ error: 'Order not found' });
    }
    orders.splice(orderIndex, 1);
    fs.writeFile(ordersFilePath, JSON.stringify(orders, null, 2), (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete order' });
      }
      res.json({ success: true });
    });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Helper to notify clients
function notifyMenuUpdate() {
  io.emit('menuUpdated');
}