const express = require("express");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;

const app = express();

// middleware
app.use(cors());
app.use(express.json());

// verify jwt
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }

  const token = authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      res.status(403).send({ error: true, message: "unauthorized" });
    }
    req.decoded = decoded;
    
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.l0lz8w0.mongodb.net/?retryWrites=true&w=majority`;

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
    const classCollection = client.db("summerCamp").collection("classes");
    const selectedClassCollection = client
      .db("summerCamp")
      .collection("selectedClasses");
    const instructorCollection = client
      .db("summerCamp")
      .collection("instructors");
    const userCollection = client.db("summerCamp").collection("users");
    const paymentCollection = client.db("summerCamp").collection("payments");

    // jwt token
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // verify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (user?.role !== "admin") {
        return res.status(403).send({ error: true, message: "forbidden" });
      }
      next();
    };

    // verify Instructor
    const verifyInstructor = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (user?.role !== "instructor") {
        return res.status(403).send({ error: true, message: "forbidden" });
      }
      next();
    };

    // payment intent
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { totalPrice } = req.body;
      const amount = totalPrice * 100;

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // payment info
    app.post("/payments", verifyJWT, async (req, res) => {
      const paymentDetails = req.body;
      const result = await paymentCollection.insertOne(paymentDetails);
      res.send(result);
    });

    // all classes api
    app.get("/classes", async (req, res) => {
      const limit = parseInt(req.query.limit);
      const query = { status: "approved" };
      const result = await classCollection.find(query).limit(limit).toArray();
      res.send(result);
    });

    app.get("/classes/allClasses", verifyJWT, verifyAdmin, async (req, res) => {
      const limit = parseInt(req.query.limit);
      const result = await classCollection.find().limit(limit).toArray();
      res.send(result);
    });

    app.patch(
      "/classes/allClasses",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const updatedStatus = req.body;
        const { id, status } = updatedStatus;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status: status,
          },
        };
        const result = await classCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    // admin feedback
    app.put(
      "/classes/feedback/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const feedbackData = req.body;
        const filter = { _id: new ObjectId(id) };
        const options = { upset: true };
        const updatedDoc = {
          $set: {
            Feedback: feedbackData,
          },
        };
        const result = await classCollection.updateOne(
          filter,
          updatedDoc,
          options
        );
        res.send(result);
      }
    );

    app.post(
      "/classes/addClass",
      verifyJWT,
      verifyInstructor,
      async (req, res) => {
        const newClass = req.body;
        const result = await classCollection.insertOne(newClass);
        res.send(result);
      }
    );

    app.get("/classes/instructorClasses", verifyJWT, async (req, res) => {
      const instructorEmail = req.query.email;
      const query = { email: instructorEmail };
      const result = await classCollection.find(query).toArray();
      res.send(result);
    });

    app.delete(
      "/classes/instructorClasses/:id",
      verifyJWT,
      verifyInstructor,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await classCollection.deleteOne(query);
        res.send(result);
      }
    );

    // enrolled class api
    app.post("/classes/selected", verifyJWT, async (req, res) => {
      const enrolledClass = req.body;
      const result = await selectedClassCollection.insertOne(enrolledClass);
      res.send(result);
    });

    app.get("/classes/selected", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const query = { userEmail: email };
      const result = await selectedClassCollection.find(query).toArray();
      res.send(result);
    });

    app.delete("/classes/selected/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await selectedClassCollection.deleteOne(query);
      res.send(result);
    });

    // instructors api
    app.get("/instructors", async (req, res) => {
      const limit = parseInt(req.query.limit);
      const result = await instructorCollection.find().limit(limit).toArray();
      res.send(result);
    });

    // users api
    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      const query = { email: userInfo.email };
      const userExists = await userCollection.findOne(query);
      if (userExists) {
        return;
      }
      const result = await userCollection.insertOne(userInfo);
      res.send(result);
    });

    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/role", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const options = {
        projection: { _id: 0, role: 1 },
      };
      const result = await userCollection.findOne(query, options);
      res.send(result);
    });

    app.get("/users/details", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const options = {
        projection: { _id: 0, name: 1, email: 1, photoURL: 1, role: 1 },
      };
      const result = await userCollection.findOne(query, options);
      res.send(result);
    });

    app.patch("/users", async (req, res) => {
      const updatedRole = req.body;
      const filter = { _id: new ObjectId(updatedRole.id) };
      const updatedUser = {
        $set: {
          role: updatedRole.role,
        },
      };
      const result = await userCollection.updateOne(filter, updatedUser);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
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
  res.send("server is running");
});

app.listen(port, () => {
  console.log(`server is running at port ${port}`);
});
