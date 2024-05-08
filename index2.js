const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const fs = require('fs');
const csvParse = require('csv-parse/lib/sync');

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB database
mongoose.connect('mongodb://localhost:27017/task-fantasy-cricket', { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));

// Middleware
app.use(bodyParser.json());

// Define MongoDB Schema
const teamEntrySchema = new mongoose.Schema({
    teamName: String,
    players: [String],
    captain: String,
    viceCaptain: String,
    totalPoints: Number
});

const TeamEntry = mongoose.model('TeamEntry', teamEntrySchema);

// Read JSON file
function readJSONFile(filename) {
    const rawData = fs.readFileSync(filename);
    return JSON.parse(rawData);
}

// Read CSV file
function readCSVFile(filename) {
    const rawData = fs.readFileSync(filename);
    return csvParse(rawData, { columns: true });
}

// Populate MongoDB with players from JSON and CSV files
function populatePlayers() {
    const playersJSON = readJSONFile('data/players.json');
    const playersCSV = readCSVFile('data/players.csv');

    const players = [...playersJSON, ...playersCSV.map(player => player.name)];

    return players;
}

// Populate MongoDB with match data from JSON and CSV files
function populateMatchData() {
    const matchJSON = readJSONFile('data/match.json');
    const matchCSV = readCSVFile('data/match.csv');

    const matchData = [...matchJSON, ...matchCSV];

    return matchData;
}

// Add Team Entry
app.post('/add-team', async (req, res) => {
    try {
        // Validate team entry
        const { teamName, players, captain, viceCaptain } = req.body;

        // Check if the team has 11 players
        if (players.length !== 11) {
            return res.status(400).json({ error: 'A team must have 11 players' });
        }

        // Check if captain and vice-captain are valid players
        if (!players.includes(captain) || !players.includes(viceCaptain)) {
            return res.status(400).json({ error: 'Captain or vice-captain not found in players list' });
        }

        // Save the team entry to the database
        const teamEntry = new TeamEntry(req.body);
        await teamEntry.save();
        res.status(201).json({ message: 'Team entry added successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add team entry' });
    }
});

// Process Match Result
app.post('/process-result', async (req, res) => {
    try {
        // Update team entries with points based on match results
        const matchData = populateMatchData();
        const teams = await TeamEntry.find();

        teams.forEach(team => {
            team.totalPoints = calculateTotalPoints(team, matchData);
            team.save();
        });

        res.status(200).json({ message: 'Match result processed successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to process match result' });
    }
});

// View Teams Results
app.get('/team-result', async (req, res) => {
    try {
        // Retrieve team results from the database
        const teams = await TeamEntry.find().sort({ totalPoints: -1 });
        const topScore = teams[0].totalPoints;
        const winningTeams = teams.filter(team => team.totalPoints === topScore);
        res.status(200).json(winningTeams);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve team results' });
    }
});

// Calculate total points for a team
function calculateTotalPoints(team, matchData) {
    let totalPoints = 0;
    const players = team.players;

    matchData.forEach(ball => {
        if (players.includes(ball.batsman)) {
            totalPoints += calculateBattingPoints(ball);
        } else if (players.includes(ball.bowler)) {
            totalPoints += calculateBowlingPoints(ball);
        } else if (players.includes(ball.fielder)) {
            totalPoints += calculateFieldingPoints(ball);
        }
    });

    return totalPoints;
}

// Calculate batting points
function calculateBattingPoints(ball) {
    let points = 0;
    if (ball.runs_batter > 0) {
        points += ball.runs_batter;
        points += calculateBoundaryPoints(ball);
        points += calculateSixPoints(ball);
        if (ball.runs_batter >= 30 && ball.runs_batter < 50) {
            points += 4; // 30 runs bonus
        } else if (ball.runs_batter >= 50 && ball.runs_batter < 100) {
            points += 8; // Half-century bonus
        } else if (ball.runs_batter >= 100) {
            points += 16; // Century bonus
        }
    } else if (ball.dismissal === 'bowled' || ball.dismissal === 'lbw') {
        points -= 2; // Dismissal for a duck
    }
    return points;
}

// Calculate boundary points
function calculateBoundaryPoints(ball) {
    return ball.runs_batter === 4 ? 1 : 0;
}

// Calculate six points
function calculateSixPoints(ball) {
    return ball.runs_batter === 6 ? 2 : 0;
}

// Calculate bowling points
function calculateBowlingPoints(ball) {
    let points = 0;
    if (ball.wickets > 0) {
        points += ball.wickets * 25;
        if (ball.dismissal === 'lbw' || ball.dismissal === 'bowled') {
            points += 8; // Bonus for LBW or Bowled
        }
        if (ball.wickets >= 3) {
            points += 4; // 3 Wicket Bonus
        }
        if (ball.wickets >= 4) {
            points += 8; // 4 Wicket Bonus
        }
        if (ball.wickets >= 5) {
            points += 16; // 5 Wicket Bonus
        }
    }
    if (ball.maiden) {
        points += 12; // Maiden Over Bonus
    }
    return points;
}

// Calculate fielding points
function calculateFieldingPoints(ball) {
    let points = 0;
    if (ball.dismissal === 'caught') {
        points += 8; // Catch
        if (ball.fielder === 'keeper') {
            points += 12; // Stumping
        }
    } else if (ball.dismissal === 'run out' || ball.dismissal === 'stumping') {
        points += 6; // Run Out or Stumping
    }
    return points;
}

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
