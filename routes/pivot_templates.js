const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');

const router = express.Router();

// Get all templates
router.get('/', isAuthenticated, hasPermission('reports:view_pivot'), async (req, res) => {
    try {
        const templates = await db('pivot_templates')
            .select('id', 'name')
            .where('created_by', req.session.user.id)
            .orderBy('name');
        res.json(templates);
    } catch (error) {
        console.error("Error fetching templates:", error);
        res.status(500).json({ message: "Failed to load templates." });
    }
});

// Get a single template by ID
router.get('/:id', isAuthenticated, hasPermission('reports:view_pivot'), async (req, res) => {
    try {
        const template = await db('pivot_templates')
            .where({ id: req.params.id, created_by: req.session.user.id })
            .first();
        if (template) {
            res.json(template);
        } else {
            res.status(404).json({ message: "Template not found or you don't have permission." });
        }
    } catch (error) {
        console.error("Error fetching template:", error);
        res.status(500).json({ message: "Error loading template." });
    }
});

// Save a new template
router.post('/', isAuthenticated, hasPermission('reports:view_pivot'), async (req, res) => {
    const { name, report } = req.body;
    if (!name || !report) {
        return res.status(400).json({ message: "Template name and report configuration are required." });
    }
    try {
        const [id] = await db('pivot_templates').insert({
            name: name,
            report: JSON.stringify(report),
            created_by: req.session.user.id
        });
        res.status(201).json({ message: "Template saved successfully.", id });
    } catch (error) {
        console.error("Error saving template:", error);
        res.status(500).json({ message: "Failed to save template." });
    }
});

// Delete a template
router.delete('/:id', isAuthenticated, hasPermission('reports:view_pivot'), async (req, res) => {
    try {
        const count = await db('pivot_templates')
            .where({ id: req.params.id, created_by: req.session.user.id })
            .del();
        
        if (count > 0) {
            res.json({ message: "Template deleted successfully." });
        } else {
            res.status(404).json({ message: "Template not found or you don't have permission." });
        }
    } catch (error) {
        console.error("Error deleting template:", error);
        res.status(500).json({ message: "Failed to delete template." });
    }
});

module.exports = router;
