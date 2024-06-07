const express = require("express");
const cors = require("cors");
var jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_KEY);
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173"],
  })
);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.73df8lc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const newsCollection = client.db("headline-hub").collection("news");
    const usersCollection = client.db("headline-hub").collection("users");
    const paymentsCollection = client.db("headline-hub").collection("payments");
    const publishersCollection = client
      .db("headline-hub")
      .collection("publishers");

    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res
          .status(401)
          .send({ message: "Unauthorized access: No authorization header" });
      }

      const token = req.headers.authorization.split(" ")[1];

      jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }

        req.decoded = decoded;
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };

      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "admin";

      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    // news api
    app.get("/all-news", async (req, res) => {
      const { search, publisher, category, status } = req.query;

      const filter = {};

      if (search) {
        filter.title = { $regex: search, $options: "i" };
      }

      if (publisher) {
        filter.publisher = publisher;
      }

      if (category) {
        filter.category = category;
      }

      if (status) {
        filter.status = status;
      }

      const result = await newsCollection.find(filter).toArray();
      res.send(result);
    });

    app.get("/news/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await newsCollection.findOne(query);
      res.send(result);
    });

    app.post("/news", verifyToken, async (req, res) => {
      const news = req.body;

      const result = await newsCollection.insertOne(news);

      res.send(result);
    });

    app.patch(
      "/approve-news/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status: "active",
          },
        };

        const result = await newsCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );

    app.patch("/news-increment-view/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };

      const updatedDoc = {
        $inc: { viewCount: 1 },
      };

      const result = await newsCollection.updateOne(filter, updatedDoc);

      res.send(result);
    });

    app.patch(
      "/decline-feedback/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const feedback = req.body;

        const filter = { _id: new ObjectId(id) };
        const options = { upsert: true };

        const updatedDoc = {
          $set: { feedback: feedback.feedback, status: "decline" },
        };

        const result = await newsCollection.updateOne(
          filter,
          updatedDoc,
          options
        );

        res.send(result);
      }
    );

    app.patch(
      "/news-make-premium/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const options = { upsert: true };

        const updatedDoc = {
          $set: {
            isPremium: true,
          },
        };

        const result = await newsCollection.updateOne(
          filter,
          updatedDoc,
          options
        );

        res.send(result);
      }
    );

    app.delete("/news/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await newsCollection.deleteOne(query);
      res.send(result);
    });

    // jwt api
    app.post("/jwt", async (req, res) => {
      const payload = req.body;

      const token = jwt.sign(payload, process.env.ACCESS_TOKEN, {
        expiresIn: "10h",
      });

      res.send({ token });
    });

    // Publisher api
    app.get("/publishers", verifyToken, async (req, res) => {
      const result = await publishersCollection.find().toArray();
      res.send(result);
    });

    app.post("/publishers", async (req, res) => {
      const data = req.body;

      const result = await publishersCollection.insertOne(data.publisher_info);

      res.send(result);
    });

    app.delete("/publishers/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await publishersCollection.deleteOne(query);
      res.send(result);
    });

    // users api
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.get(
      "/users/admin/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;

        if (email !== req.decoded.email) {
          return res.status(403).send({ message: "forbidden access" });
        }

        const query = { email: email };
        const user = await usersCollection.findOne(query);

        let admin = false;

        if (user) {
          admin = user?.role === "admin";
        }

        res.send({ admin });
      }
    );

    app.post("/users", async (req, res) => {
      const user = req.body;

      const query = { email: user.email };

      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };

        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };

        const result = await usersCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    // publishers api
    app.get("/publishers", async (req, res) => {
      const result = await publishersCollection.find().toArray();
      res.send(result);
    });

    app.post("/publishers", verifyToken, verifyAdmin, async (req, res) => {
      const publisher = req.body;
      const result = publishersCollection.insertOne(publisher);
      res.send(result);
    });

    app.get("/publishers-stats", verifyToken, verifyAdmin, async (req, res) => {
      const publishers = await publishersCollection.find().toArray();
      const articles = await newsCollection.find().toArray();

      const publishersStats = publishers.map((publisher) => {
        const articlesCount = articles.filter(
          (article) => article.publisher === publisher.name
        ).length;
        return { publisher: publisher.name, articlesCount };
      });

      res.send(publishersStats);
    });

    // subscribe api

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World");
});

app.listen(port);
