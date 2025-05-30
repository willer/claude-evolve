#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

// Configuration
const CHART_WIDTH = 800;
const CHART_HEIGHT = 600;

class EvolutionAnalyzer {
    constructor(csvPath) {
        this.csvPath = csvPath;
        this.data = [];
    }

    async loadData() {
        if (!fs.existsSync(this.csvPath)) {
            throw new Error(`CSV file not found: ${this.csvPath}`);
        }

        return new Promise((resolve, reject) => {
            const results = [];
            
            fs.createReadStream(this.csvPath)
                .pipe(csv())
                .on('data', (row) => {
                    // Parse numeric fields and validate data
                    const id = parseInt(row.id);
                    const basedOnId = row.basedOnId ? parseInt(row.basedOnId) : null;
                    const performance = row.performance ? parseFloat(row.performance) : null;
                    
                    if (!isNaN(id) && row.description) {
                        results.push({
                            id,
                            basedOnId,
                            description: row.description.trim(),
                            performance,
                            status: row.status || ''
                        });
                    }
                })
                .on('end', () => {
                    this.data = results;
                    resolve(results);
                })
                .on('error', (error) => {
                    reject(error);
                });
        });
    }

    getCompletedCandidates() {
        return this.data.filter(item => 
            item.status === 'completed' && 
            item.performance !== null && 
            !isNaN(item.performance)
        );
    }

    findTopPerformer() {
        const completed = this.getCompletedCandidates();
        
        if (completed.length === 0) {
            return null;
        }

        return completed.reduce((best, current) => 
            current.performance > best.performance ? current : best
        );
    }

    generateSummaryTable() {
        const completed = this.getCompletedCandidates();
        const running = this.data.filter(item => item.status === 'running').length;
        const failed = this.data.filter(item => item.status === 'failed').length;
        const pending = this.data.filter(item => !item.status || item.status === '').length;
        
        const topPerformer = this.findTopPerformer();
        
        const table = {
            total: this.data.length,
            completed: completed.length,
            running,
            failed,
            pending,
            topPerformer: topPerformer ? {
                id: topPerformer.id,
                description: topPerformer.description,
                performance: topPerformer.performance
            } : null,
            avgPerformance: completed.length > 0 ? 
                completed.reduce((sum, item) => sum + item.performance, 0) / completed.length : null
        };

        return table;
    }

    async generateChart(outputPath) {
        const completed = this.getCompletedCandidates();
        
        if (completed.length === 0) {
            throw new Error('No completed candidates to chart');
        }

        // Sort by ID to show evolution progression
        completed.sort((a, b) => a.id - b.id);

        const chartJSNodeCanvas = new ChartJSNodeCanvas({
            width: CHART_WIDTH,
            height: CHART_HEIGHT,
            backgroundColor: 'white'
        });

        const configuration = {
            type: 'line',
            data: {
                labels: completed.map(item => `ID ${item.id}`),
                datasets: [{
                    label: 'Performance Score',
                    data: completed.map(item => item.performance),
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    tension: 0.1,
                    fill: false
                }]
            },
            options: {
                responsive: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Algorithm Evolution Performance'
                    },
                    legend: {
                        display: true
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Evolution Candidates'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Performance Score'
                        }
                    }
                }
            }
        };

        const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
        
        // Ensure output directory exists
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(outputPath, imageBuffer);
        return outputPath;
    }

    displaySummary() {
        const summary = this.generateSummaryTable();
        
        console.log('\n=== Evolution Analysis Summary ===\n');
        console.log(`Total Candidates: ${summary.total}`);
        console.log(`Completed: ${summary.completed}`);
        console.log(`Running: ${summary.running}`);
        console.log(`Failed: ${summary.failed}`);
        console.log(`Pending: ${summary.pending}`);
        
        if (summary.avgPerformance !== null) {
            console.log(`Average Performance: ${summary.avgPerformance.toFixed(4)}`);
        }
        
        if (summary.topPerformer) {
            console.log('\n=== Top Performer ===');
            console.log(`ID: ${summary.topPerformer.id}`);
            console.log(`Performance: ${summary.topPerformer.performance}`);
            console.log(`Description: ${summary.topPerformer.description}`);
        } else {
            console.log('\nNo completed candidates found.');
        }
        
        console.log('');
    }
}

async function openFile(filePath) {
    const { exec } = require('child_process');
    const platform = process.platform;
    
    let command;
    if (platform === 'darwin') {
        command = `open "${filePath}"`;
    } else if (platform === 'linux') {
        command = `xdg-open "${filePath}"`;
    } else {
        throw new Error(`Unsupported platform for auto-open: ${platform}`);
    }
    
    return new Promise((resolve, reject) => {
        exec(command, (error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

async function main() {
    const args = process.argv.slice(2);
    let shouldOpen = false;
    let csvPath = './evolution/evolution.csv';
    let outputPath = './evolution/performance.png';
    
    // Parse arguments
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--help':
                console.log('claude-evolve analyze - Analyze evolution results');
                console.log('');
                console.log('USAGE:');
                console.log('  claude-evolve analyze [--open] [--csv <path>] [--output <path>]');
                console.log('');
                console.log('OPTIONS:');
                console.log('  --open            Open the generated chart automatically');
                console.log('  --csv <path>      Path to evolution.csv (default: ./evolution/evolution.csv)');
                console.log('  --output <path>   Output path for chart PNG (default: ./evolution/performance.png)');
                console.log('  --help            Show this help message');
                console.log('');
                console.log('DESCRIPTION:');
                console.log('  Analyzes the evolution.csv file and generates a performance chart.');
                console.log('  Displays summary statistics and identifies the top performing algorithm.');
                process.exit(0);
                break;
            case '--open':
                shouldOpen = true;
                break;
            case '--csv':
                if (i + 1 < args.length) {
                    csvPath = args[++i];
                } else {
                    console.error('Error: --csv requires a path argument');
                    process.exit(1);
                }
                break;
            case '--output':
                if (i + 1 < args.length) {
                    outputPath = args[++i];
                } else {
                    console.error('Error: --output requires a path argument');
                    process.exit(1);
                }
                break;
            default:
                console.error(`Error: Unknown option ${args[i]}`);
                process.exit(1);
        }
    }

    try {
        const analyzer = new EvolutionAnalyzer(csvPath);
        await analyzer.loadData();
        
        // Display summary table
        analyzer.displaySummary();
        
        // Generate chart if we have data
        const completed = analyzer.getCompletedCandidates();
        if (completed.length > 0) {
            console.log(`Generating performance chart: ${outputPath}`);
            await analyzer.generateChart(outputPath);
            console.log(`Chart saved successfully!`);
            
            if (shouldOpen) {
                console.log('Opening chart...');
                try {
                    await openFile(outputPath);
                } catch (error) {
                    console.error(`Failed to open chart: ${error.message}`);
                    process.exit(1);
                }
            }
        } else {
            console.log('No completed candidates found - skipping chart generation.');
            if (shouldOpen) {
                console.log('Cannot open chart: no data to display.');
            }
        }
        
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}