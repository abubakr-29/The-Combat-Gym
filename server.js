import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import multer from "multer";
import path from "path";
import env from "dotenv";
import fs from "fs";
import bcrypt from "bcrypt";
import session from "express-session";

env.config();

const app = express();
const port = process.env.LOCALHOST_PORT;

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
    store: new session.MemoryStore(),
  })
);

const storage = multer.diskStorage({
  destination: "./public/uploads",
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect("/login");
}

app.get("/", async (req, res) => {
  try {
    const classesResult = await db.query(
      `SELECT * FROM classes ORDER BY id ASC LIMIT 3`
    );
    const classes = classesResult.rows;

    const testimonialsResult = await db.query(`
      SELECT * FROM testimonials ORDER BY id ASC
    `);
    const testimonials = testimonialsResult.rows;

    res.render("index.ejs", {
      listItems: classes,
      testimonials,
    });
  } catch (err) {
    console.error("Error fetching data:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/players", async (req, res) => {
  try {
    const players = await db.query("SELECT * FROM players ORDER BY name");

    if (players.rows.length > 0) {
      res.render("players.ejs", {
        players: players.rows,
        noPlayersFound: false,
      });
    } else {
      res.render("players.ejs", {
        noPlayersFound: true,
      });
    }
  } catch (err) {
    console.error("Error fetching data:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/search-players", async (req, res) => {
  const searchQuery = req.body.search.toLowerCase();

  try {
    const result = await db.query(
      "SELECT * FROM players WHERE LOWER(name) LIKE '%' || $1 || '%'",
      [searchQuery.toLowerCase()]
    );

    if (result.rows.length > 0) {
      res.render("players.ejs", {
        players: result.rows,
        noPlayersFound: false,
      });
    } else {
      res.render("players.ejs", {
        noPlayersFound: true,
      });
    }
  } catch (err) {
    console.error("Error searching for classes:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/players/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const result = await db.query("SELECT * FROM players WHERE id = $1", [id]);

    if (!result) {
      res.status(404).send("Dog not found");
      return;
    }

    res.render("detail.ejs", {
      player: result.rows[0],
    });
  } catch (err) {
    console.error("Error fetching dog details:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/classes", async (req, res) => {
  try {
    const classes = await db.query("SELECT * FROM classes ORDER BY id ASC");

    if (classes.rows.length > 0) {
      res.render("classes.ejs", {
        classes: classes.rows,
        noClassesFound: false,
      });
    } else {
      res.render("classes.ejs", {
        noClassesFound: true,
      });
    }
  } catch (err) {
    console.error("Error fetching dog data:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/search", async (req, res) => {
  const searchQuery = req.body.search.toLowerCase();

  try {
    const result = await db.query(
      "SELECT * FROM classes WHERE LOWER(name) LIKE '%' || $1 || '%'",
      [searchQuery.toLowerCase()]
    );

    if (result.rows.length > 0) {
      res.render("classes.ejs", {
        classes: result.rows,
        noClassesFound: false,
      });
    } else {
      res.render("classes.ejs", {
        noClassesFound: true,
      });
    }
  } catch (err) {
    console.error("Error searching for classes:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/about", (req, res) => {
  res.render("about.ejs");
});

app.get("/contact", (req, res) => {
  res.render("contact.ejs");
});

app.get("/admin", isAuthenticated, async (req, res) => {
  const rowsPerPage = 5;
  const currentPage = parseInt(req.query.page) || 1;
  const offset = (currentPage - 1) * rowsPerPage;

  try {
    const playersQuery = await db.query(
      "SELECT * FROM players ORDER BY name LIMIT $1 OFFSET $2",
      [rowsPerPage, offset]
    );

    const totalPlayersQuery = await db.query("SELECT COUNT(*) FROM players");
    const totalPlayers = parseInt(totalPlayersQuery.rows[0].count);
    const totalPages = Math.ceil(totalPlayers / rowsPerPage);

    if (playersQuery.rows.length > 0) {
      res.render("admin.ejs", {
        players: playersQuery.rows,
        currentPage,
        totalPages,
        noPlayersFound: false,
      });
    } else {
      res.render("admin.ejs", {
        currentPage: 0,
        totalPages: 0,
        noPlayersFound: true,
      });
    }
  } catch (err) {
    console.error("Error fetching data:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/admin/add-player", async (req, res) => {
  res.render("new.ejs");
});

app.post("/admin/add-player/new", upload.single("image"), async (req, res) => {
  const {
    name,
    nickname,
    coach,
    club,
    birth_place,
    gender,
    height,
    weight,
    win,
    draw,
    lose,
  } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    await db.query(
      "INSERT INTO players (name, nickname, coach, club, birth_place, gender, height, weight, win, draw, lose, image) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
      [
        name,
        nickname,
        coach,
        club,
        birth_place,
        gender,
        height,
        weight,
        win,
        draw,
        lose,
        image,
      ]
    );
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating player");
  }
});

app.get("/admin/modify/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const player = await db.query("SELECT * FROM players WHERE id = $1", [id]);

    if (!player) {
      return res.status(404).render("error", { message: "Player not found." });
    }

    res.render("modify.ejs", { player: player.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

app.post(
  "/admin/modify/player/:id/update",
  upload.single("image"),
  async (req, res) => {
    const { id } = req.params;
    const {
      name,
      nickname,
      coach,
      club,
      birthplace,
      gender,
      weight,
      height,
      win,
      draw,
      lose,
    } = req.body;
    const image = req.file ? `/uploads/${req.file.filename}` : null;

    try {
      const currentPlayer = await db.query(
        "SELECT * FROM players WHERE id = $1",
        [id]
      );

      if (!currentPlayer) {
        return res.status(404).send("Player not found.");
      }

      if (image && currentPlayer.rows[0].image) {
        const oldImagePath = path.join("public", currentPlayer.rows[0].image);
        if (fs.existsSync(oldImagePath)) {
          try {
            fs.unlinkSync(oldImagePath);
          } catch (err) {
            console.error(`Error deleting file: ${oldImagePath}`, err);
          }
        }
      }

      await db.query(
        `
        UPDATE players
        SET name = $1, nickname = $2, coach = $3, club = $4, birth_place = $5, gender = $6, weight = $7, height = $8, win = $9, draw = $10, lose = $11, image = COALESCE($12, image)
        WHERE id = $13
      `,
        [
          name,
          nickname,
          coach,
          club,
          birthplace,
          gender,
          weight,
          height,
          win,
          draw,
          lose,
          image,
          id,
        ]
      );

      res.redirect(`/admin`);
    } catch (err) {
      console.error(err);
      res.status(500).send("Error updating player data");
    }
  }
);

app.post("/admin/delete/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const currentPlayer = await db.query(
      "SELECT * FROM players WHERE id = $1",
      [id]
    );

    if (!currentPlayer) {
      return res.status(404).send("Player not found.");
    }

    if (currentPlayer.rows[0].image) {
      const oldImagePath = path.join("public", currentPlayer.rows[0].image);
      if (fs.existsSync(oldImagePath)) {
        try {
          fs.unlinkSync(oldImagePath);
        } catch (err) {
          console.error(`Error deleting file: ${oldImagePath}`, err);
        }
      }
    }

    await db.query("DELETE FROM players WHERE id = $1", [id]);
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error deleting player");
  }
});

app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await db.query("SELECT * FROM users WHERE username = $1", [
      username,
    ]);
    const user = result.rows[0];

    if (user && (await bcrypt.compare(password, user.password))) {
      req.session.user = username;
      res.redirect("/admin");
    } else {
      res.status(401).send("Invalid username or password");
    }
  } catch (err) {
    console.error("Error during login:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
