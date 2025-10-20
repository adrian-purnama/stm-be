const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const { getQuotationAnalysis } = require('../utils/quotationHelper');

// ============================================================================
// QUOTATION ANALYSIS ROUTES
// ============================================================================

// Get quotation analysis/statistics overview
router.get('/overview', authenticateToken, authorize('user', 'admin'), async (req, res) => {
  try {
    const { startDate, endDate, metric } = req.query;
    const analysis = await getQuotationAnalysis({ 
      startDate, 
      endDate, 
      metric, 
      userId: req.user.userId 
    });
    res.json({
      success: true,
      data: analysis,
      message: 'Quotation analysis retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting quotation analysis:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Get detailed quotation statistics by status
router.get('/status-breakdown', authenticateToken, authorize('user', 'admin'), async (req, res) => {
  try {
    const { userId } = req.user;
    const analysis = await getQuotationAnalysis(userId);
    
    // Extract status breakdown from analysis
    const statusBreakdown = {
      total: analysis.totalQuotations,
      byStatus: analysis.statusBreakdown,
      winRate: analysis.winRate,
      lossRate: analysis.lossRate,
      pendingRate: analysis.pendingRate
    };
    
    res.json({
      success: true,
      data: statusBreakdown,
      message: 'Status breakdown retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting status breakdown:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Get follow-up status analysis
router.get('/follow-up-status', authenticateToken, authorize('user', 'admin'), async (req, res) => {
  try {
    const { userId } = req.user;
    const analysis = await getQuotationAnalysis(userId);
    
    // Extract follow-up status from analysis
    const followUpAnalysis = {
      followUpStatus: analysis.followUpStatus,
      totalQuotations: analysis.totalQuotations,
      followUpRate: analysis.followUpRate
    };
    
    res.json({
      success: true,
      data: followUpAnalysis,
      message: 'Follow-up status analysis retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting follow-up status analysis:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Get quotation trends over time
router.get('/trends', authenticateToken, authorize('user', 'admin'), async (req, res) => {
  try {
    const { userId } = req.user;
    const { period = '30d' } = req.query; // 7d, 30d, 90d, 1y
    
    const analysis = await getQuotationAnalysis(userId, { period });
    
    // Extract trends data
    const trends = {
      period,
      totalQuotations: analysis.totalQuotations,
      monthlyTrends: analysis.monthlyTrends,
      winRateTrend: analysis.winRateTrend,
      followUpTrend: analysis.followUpTrend
    };
    
    res.json({
      success: true,
      data: trends,
      message: 'Quotation trends retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting quotation trends:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Get customer analysis
router.get('/customers', authenticateToken, authorize('user', 'admin'), async (req, res) => {
  try {
    const { userId } = req.user;
    const analysis = await getQuotationAnalysis(userId);
    
    // Extract customer analysis
    const customerAnalysis = {
      totalCustomers: analysis.totalCustomers,
      topCustomers: analysis.topCustomers,
      customerWinRate: analysis.customerWinRate,
      repeatCustomers: analysis.repeatCustomers
    };
    
    res.json({
      success: true,
      data: customerAnalysis,
      message: 'Customer analysis retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting customer analysis:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Get performance metrics
router.get('/performance', authenticateToken, authorize('user', 'admin'), async (req, res) => {
  try {
    const { userId } = req.user;
    const analysis = await getQuotationAnalysis(userId);
    
    // Extract performance metrics
    const performance = {
      totalQuotations: analysis.totalQuotations,
      totalValue: analysis.totalValue,
      averageQuotationValue: analysis.averageQuotationValue,
      winRate: analysis.winRate,
      lossRate: analysis.lossRate,
      pendingRate: analysis.pendingRate,
      followUpRate: analysis.followUpRate,
      averageResponseTime: analysis.averageResponseTime
    };
    
    res.json({
      success: true,
      data: performance,
      message: 'Performance metrics retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting performance metrics:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Get export data for analysis
router.get('/export', authenticateToken, authorize('user', 'admin'), async (req, res) => {
  try {
    const { userId } = req.user;
    const { format = 'json', startDate, endDate, metric } = req.query; // json, csv, xlsx
    
    const analysis = await getQuotationAnalysis({ 
      startDate, 
      endDate, 
      metric, 
      userId,
      export: true 
    });
    
    if (format === 'csv') {
      // Convert to CSV format
      const csvData = convertAnalysisToCSV(analysis);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="quotation-analysis.csv"');
      res.send(csvData);
    } else if (format === 'xlsx') {
      // Convert to Excel format
      const excelBuffer = await convertAnalysisToExcel(analysis);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="quotation-analysis.xlsx"');
      res.send(excelBuffer);
    } else {
      // Default JSON format
      res.json({
        success: true,
        data: analysis,
        message: 'Analysis data exported successfully'
      });
    }
  } catch (error) {
    console.error('Error exporting analysis data:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Helper function to convert analysis to CSV
const convertAnalysisToCSV = (analysis) => {
  const headers = [
    'Metric',
    'Value',
    'Percentage'
  ];
  
  const rows = [
    ['Total Quotations', analysis.totalQuotations, '100%'],
    ['Win Rate', analysis.winRate, `${analysis.winRate}%`],
    ['Loss Rate', analysis.lossRate, `${analysis.lossRate}%`],
    ['Pending Rate', analysis.pendingRate, `${analysis.pendingRate}%`],
    ['Follow-up Rate', analysis.followUpRate, `${analysis.followUpRate}%`],
    ['Total Value', analysis.totalValue, ''],
    ['Average Quotation Value', analysis.averageQuotationValue, '']
  ];
  
  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n');
  
  return csvContent;
};

// Helper function to convert analysis to Excel (placeholder)
const convertAnalysisToExcel = async (analysis) => {
  // This would require a library like 'xlsx' to implement
  // For now, return a placeholder
  throw new Error('Excel export not yet implemented');
};

module.exports = router;
