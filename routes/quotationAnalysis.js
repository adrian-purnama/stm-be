const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const { getQuotationAnalysis } = require('../utils/quotationHelper');

// ============================================================================
// QUOTATION ANALYSIS ROUTES
// ============================================================================

// Get quotation analysis/statistics overview
router.get('/overview', authenticateToken, authorize(["placeholder_test"]), async (req, res) => {
  try {
    const { startDate, endDate, metric } = req.query;
    
    // Validate and prepare parameters
    const params = {
      userId: req.user?.userId || null
    };
    
    // Only add date parameters if they are valid
    if (startDate && typeof startDate === 'string' && startDate.trim()) {
      params.startDate = startDate.trim();
    }
    if (endDate && typeof endDate === 'string' && endDate.trim()) {
      params.endDate = endDate.trim();
    }
    if (metric && typeof metric === 'string') {
      params.metric = metric;
    }
    
    const analysis = await getQuotationAnalysis(params);
    
    // Ensure analysis object has all required fields with defaults
    const safeAnalysis = {
      totalQuotations: analysis?.totalQuotations || 0,
      winRate: analysis?.winRate || 0,
      lossRate: analysis?.lossRate || 0,
      closeRate: analysis?.closeRate || 0,
      statusBreakdown: analysis?.statusBreakdown || { open: { count: 0 }, win: { count: 0 }, loss: { count: 0 }, close: { count: 0 } },
      reasonAnalytics: analysis?.reasonAnalytics || { loss: {}, close: {} },
      monthlyStats: analysis?.monthlyStats || [],
      topCustomers: analysis?.topCustomers || [],
      recentActivity: analysis?.recentActivity || [],
      timePeriodSummary: analysis?.timePeriodSummary || { startDate: '', endDate: '', period: 'year-to-date' },
      followUpStatus: analysis?.followUpStatus || { currentlyOpen: { count: 0 }, notFollowedUp: { count: 0 }, mediumWarning: { count: 0 }, upToDate: { count: 0 } },
      rfqStats: analysis?.rfqStats || { total: 0, approved: 0, rejected: 0, pending: 0 },
      bodyTypeFrequency: analysis?.bodyTypeFrequency || [],
      quarterlyStatus: analysis?.quarterlyStatus || []
    };
    
    res.json({
      success: true,
      data: safeAnalysis,
      message: 'Quotation analysis retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting quotation analysis:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to retrieve quotation analysis'
    });
  }
});

// Get detailed quotation statistics by status
router.get('/status-breakdown', authenticateToken, authorize(["placeholder_test"]), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Validate and prepare parameters
    const params = {
      userId: req.user?.userId || null
    };
    
    if (startDate && typeof startDate === 'string' && startDate.trim()) {
      params.startDate = startDate.trim();
    }
    if (endDate && typeof endDate === 'string' && endDate.trim()) {
      params.endDate = endDate.trim();
    }
    
    const analysis = await getQuotationAnalysis(params);
    
    // Extract status breakdown from analysis with safe defaults
    const statusBreakdown = {
      total: analysis?.totalQuotations || 0,
      byStatus: analysis?.statusBreakdown || { open: { count: 0 }, win: { count: 0 }, loss: { count: 0 }, close: { count: 0 } },
      winRate: analysis?.winRate || 0,
      lossRate: analysis?.lossRate || 0,
      closeRate: analysis?.closeRate || 0
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
      message: error.message || 'Failed to retrieve status breakdown'
    });
  }
});

// Get follow-up status analysis
router.get('/follow-up-status', authenticateToken, authorize(["placeholder_test"]), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Validate and prepare parameters
    const params = {
      userId: req.user?.userId || null
    };
    
    if (startDate && typeof startDate === 'string' && startDate.trim()) {
      params.startDate = startDate.trim();
    }
    if (endDate && typeof endDate === 'string' && endDate.trim()) {
      params.endDate = endDate.trim();
    }
    
    const analysis = await getQuotationAnalysis(params);
    
    // Extract follow-up status from analysis with safe defaults
    const followUpAnalysis = {
      followUpStatus: analysis?.followUpStatus || { currentlyOpen: { count: 0 }, notFollowedUp: { count: 0 }, mediumWarning: { count: 0 }, upToDate: { count: 0 } },
      totalQuotations: analysis?.totalQuotations || 0
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
      message: error.message || 'Failed to retrieve follow-up status analysis'
    });
  }
});

// Get quotation trends over time
router.get('/trends', authenticateToken, authorize(["placeholder_test"]), async (req, res) => {
  try {
    const { startDate, endDate, period = '30d' } = req.query; // 7d, 30d, 90d, 1y
    
    // Validate and prepare parameters
    const params = {
      userId: req.user?.userId || null,
      metric: period
    };
    
    if (startDate && typeof startDate === 'string' && startDate.trim()) {
      params.startDate = startDate.trim();
    }
    if (endDate && typeof endDate === 'string' && endDate.trim()) {
      params.endDate = endDate.trim();
    }
    
    const analysis = await getQuotationAnalysis(params);
    
    // Extract trends data with safe defaults
    const trends = {
      period,
      totalQuotations: analysis?.totalQuotations || 0,
      monthlyStats: analysis?.monthlyStats || [],
      winRate: analysis?.winRate || 0,
      lossRate: analysis?.lossRate || 0,
      closeRate: analysis?.closeRate || 0
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
      message: error.message || 'Failed to retrieve quotation trends'
    });
  }
});

// Get customer analysis
router.get('/customers', authenticateToken, authorize(["placeholder_test"]), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Validate and prepare parameters
    const params = {
      userId: req.user?.userId || null
    };
    
    if (startDate && typeof startDate === 'string' && startDate.trim()) {
      params.startDate = startDate.trim();
    }
    if (endDate && typeof endDate === 'string' && endDate.trim()) {
      params.endDate = endDate.trim();
    }
    
    const analysis = await getQuotationAnalysis(params);
    
    // Extract customer analysis with safe defaults
    const customerAnalysis = {
      totalCustomers: analysis?.topCustomers?.length || 0,
      topCustomers: analysis?.topCustomers || []
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
      message: error.message || 'Failed to retrieve customer analysis'
    });
  }
});

// Get performance metrics
router.get('/performance', authenticateToken, authorize(["placeholder_test"]), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Validate and prepare parameters
    const params = {
      userId: req.user?.userId || null
    };
    
    if (startDate && typeof startDate === 'string' && startDate.trim()) {
      params.startDate = startDate.trim();
    }
    if (endDate && typeof endDate === 'string' && endDate.trim()) {
      params.endDate = endDate.trim();
    }
    
    const analysis = await getQuotationAnalysis(params);
    
    // Extract performance metrics with safe defaults
    const performance = {
      totalQuotations: analysis?.totalQuotations || 0,
      winRate: analysis?.winRate || 0,
      lossRate: analysis?.lossRate || 0,
      closeRate: analysis?.closeRate || 0,
      statusBreakdown: analysis?.statusBreakdown || { open: { count: 0 }, win: { count: 0 }, loss: { count: 0 }, close: { count: 0 } },
      rfqStats: analysis?.rfqStats || { total: 0, approved: 0, rejected: 0, pending: 0 }
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
      message: error.message || 'Failed to retrieve performance metrics'
    });
  }
});

// Get export data for analysis
router.get('/export', authenticateToken, authorize(["placeholder_test"]), async (req, res) => {
  try {
    const { format = 'json', startDate, endDate, metric } = req.query; // json, csv, xlsx
    
    // Validate and prepare parameters
    const params = {
      userId: req.user?.userId || null,
      export: true
    };
    
    // Only add date parameters if they are valid
    if (startDate && typeof startDate === 'string' && startDate.trim()) {
      params.startDate = startDate.trim();
    }
    if (endDate && typeof endDate === 'string' && endDate.trim()) {
      params.endDate = endDate.trim();
    }
    if (metric && typeof metric === 'string') {
      params.metric = metric;
    }
    
    const analysis = await getQuotationAnalysis(params);
    
    // Ensure analysis object has all required fields with defaults
    const safeAnalysis = {
      totalQuotations: analysis?.totalQuotations || 0,
      winRate: analysis?.winRate || 0,
      lossRate: analysis?.lossRate || 0,
      closeRate: analysis?.closeRate || 0,
      statusBreakdown: analysis?.statusBreakdown || { open: { count: 0 }, win: { count: 0 }, loss: { count: 0 }, close: { count: 0 } },
      reasonAnalytics: analysis?.reasonAnalytics || { loss: {}, close: {} },
      monthlyStats: analysis?.monthlyStats || [],
      topCustomers: analysis?.topCustomers || [],
      recentActivity: analysis?.recentActivity || [],
      timePeriodSummary: analysis?.timePeriodSummary || { startDate: '', endDate: '', period: 'year-to-date' },
      followUpStatus: analysis?.followUpStatus || { currentlyOpen: { count: 0 }, notFollowedUp: { count: 0 }, mediumWarning: { count: 0 }, upToDate: { count: 0 } },
      rfqStats: analysis?.rfqStats || { total: 0, approved: 0, rejected: 0, pending: 0 },
      bodyTypeFrequency: analysis?.bodyTypeFrequency || [],
      quarterlyStatus: analysis?.quarterlyStatus || []
    };
    
    if (format === 'csv') {
      // Convert to CSV format
      try {
        const csvData = convertAnalysisToCSV(safeAnalysis);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="quotation-analysis.csv"');
        res.send(csvData);
      } catch (csvError) {
        console.error('Error converting to CSV:', csvError);
        res.status(500).json({
          success: false,
          message: 'Failed to convert analysis data to CSV format'
        });
      }
    } else if (format === 'xlsx') {
      // Convert to Excel format
      try {
        const excelBuffer = await convertAnalysisToExcel(safeAnalysis);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="quotation-analysis.xlsx"');
        res.send(excelBuffer);
      } catch (excelError) {
        console.error('Error converting to Excel:', excelError);
        res.status(500).json({
          success: false,
          message: excelError.message || 'Failed to convert analysis data to Excel format'
        });
      }
    } else {
      // Default JSON format
      res.json({
        success: true,
        data: safeAnalysis,
        message: 'Analysis data exported successfully'
      });
    }
  } catch (error) {
    console.error('Error exporting analysis data:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to export analysis data'
    });
  }
});

// Helper function to convert analysis to CSV
const convertAnalysisToCSV = (analysis) => {
  const rows = [];
  
  // Basic metrics
  rows.push(['Metric', 'Value']);
  rows.push(['Total Quotations', analysis.totalQuotations || 0]);
  rows.push(['Win Rate', `${analysis.winRate || 0}%`]);
  rows.push(['Loss Rate', `${analysis.lossRate || 0}%`]);
  rows.push(['Close Rate', `${analysis.closeRate || 0}%`]);
  rows.push([]);
  
  // Status breakdown
  rows.push(['Status Breakdown', '']);
  if (analysis.statusBreakdown) {
    rows.push(['Open', analysis.statusBreakdown.open?.count || 0]);
    rows.push(['Win', analysis.statusBreakdown.win?.count || 0]);
    rows.push(['Loss', analysis.statusBreakdown.loss?.count || 0]);
    rows.push(['Close', analysis.statusBreakdown.close?.count || 0]);
  }
  rows.push([]);
  
  // RFQ Statistics
  rows.push(['RFQ Statistics', '']);
  if (analysis.rfqStats) {
    rows.push(['Total RFQs', analysis.rfqStats.total || 0]);
    rows.push(['Approved', analysis.rfqStats.approved || 0]);
    rows.push(['Rejected', analysis.rfqStats.rejected || 0]);
    rows.push(['Pending', analysis.rfqStats.pending || 0]);
  }
  rows.push([]);
  
  // Follow-up Status
  rows.push(['Follow-up Status', '']);
  if (analysis.followUpStatus) {
    rows.push(['Currently Open', analysis.followUpStatus.currentlyOpen?.count || 0]);
    rows.push(['Not Followed Up', analysis.followUpStatus.notFollowedUp?.count || 0]);
    rows.push(['Medium Warning', analysis.followUpStatus.mediumWarning?.count || 0]);
    rows.push(['Up to Date', analysis.followUpStatus.upToDate?.count || 0]);
  }
  rows.push([]);
  
  // Top Customers
  rows.push(['Top Customers', '']);
  rows.push(['Customer Name', 'Quotations', 'Win', 'Loss', 'Win Rate']);
  if (analysis.topCustomers && Array.isArray(analysis.topCustomers)) {
    analysis.topCustomers.forEach(customer => {
      const winRate = customer.quotations > 0 
        ? Math.round((customer.statusBreakdown?.win || 0) / customer.quotations * 100) 
        : 0;
      rows.push([
        customer.name || 'Unknown',
        customer.quotations || 0,
        customer.statusBreakdown?.win || 0,
        customer.statusBreakdown?.loss || 0,
        `${winRate}%`
      ]);
    });
  }
  rows.push([]);
  
  // Body Type Frequency
  rows.push(['Body Type Frequency', '']);
  rows.push(['Body Type', 'RFQ Count', 'Quotation Count', 'Total']);
  if (analysis.bodyTypeFrequency && Array.isArray(analysis.bodyTypeFrequency)) {
    analysis.bodyTypeFrequency.forEach(item => {
      rows.push([
        item.name || 'Unknown',
        item.rfq || 0,
        item.quotation || 0,
        item.total || 0
      ]);
    });
  }
  rows.push([]);
  
  // Quarterly Status
  rows.push(['Quarterly Status', '']);
  rows.push(['Quarter', 'Win', 'Loss', 'Cancel', 'Open']);
  if (analysis.quarterlyStatus && Array.isArray(analysis.quarterlyStatus)) {
    analysis.quarterlyStatus.forEach(quarter => {
      rows.push([
        quarter.label || 'Unknown',
        quarter.win || 0,
        quarter.loss || 0,
        quarter.cancel || 0,
        quarter.open || 0
      ]);
    });
  }
  
  // Convert to CSV format
  const csvContent = rows
    .map(row => {
      if (row.length === 0) return '';
      return row.map(cell => {
        const cellStr = cell !== null && cell !== undefined ? String(cell) : '';
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(',');
    })
    .filter(line => line !== '') // Remove empty lines
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
