import React, { useState, useEffect, useCallback } from 'react';

interface LinkStats {
  total_links: number;
  volatile_links: number;
  foundational_links: number;
  archived_links: number;
  avg_ema: number;
  avg_access_count: number;
}

interface HebbianLink {
  source_id: string;
  target_id: string;
  access_count: number;
  access_ema: number;
  last_accessed?: string;
  created_at?: string;
  committed: 'volatile' | 'foundational' | 'archived';
}

interface HebbianStats {
  stats: LinkStats;
  recentActivity: HebbianLink[];
  nearingPromotion: HebbianLink[];
  nearingDecay: HebbianLink[];
}

const HebbianDashboardScreen: React.FC = () => {
  const [stats, setStats] = useState<HebbianStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'promotion' | 'decay' | 'activity'>('overview');

  const fetchStats = useCallback(async () => {
    try {
      const result = await window.api.hebbianGetStats();
      setStats(result);
    } catch (error) {
      console.error('Failed to fetch Hebbian stats:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    
    // Refresh every 10 seconds
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const handleForceDecay = async () => {
    setLoading(true);
    try {
      await window.api.hebbianForceDecay();
      await fetchStats();
    } catch (error) {
      console.error('Failed to run decay cycle:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTimeAgo = (dateStr?: string) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const getPromotionProgress = (link: HebbianLink) => {
    // Fast-track: access_count >= 50 AND access_ema > 0.3
    const countProgress = Math.min((link.access_count / 50) * 100, 100);
    const emaProgress = Math.min((link.access_ema / 0.3) * 100, 100);
    return { countProgress, emaProgress };
  };

  const getDecayRisk = (link: HebbianLink) => {
    // Risk based on low EMA and age
    const emaRisk = Math.max(0, (0.3 - link.access_ema) / 0.3 * 100);
    return emaRisk;
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-full text-white bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-700">
        <h1 className="text-2xl font-bold">Hebbian Learning Dashboard</h1>
        <p className="text-sm text-gray-400 mt-1">
          Monitor link formation, decay, and promotion in real-time
        </p>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="px-6 py-4 grid grid-cols-3 gap-4 border-b border-gray-700">
          <StatCard 
            label="Total Links" 
            value={stats.stats.total_links || 0} 
            color="blue"
          />
          <StatCard 
            label="Volatile (Learning)" 
            value={stats.stats.volatile_links || 0} 
            color="purple"
          />
          <StatCard 
            label="Foundational (Promoted)" 
            value={stats.stats.foundational_links || 0} 
            color="green"
          />
          <StatCard 
            label="Avg EMA" 
            value={(stats.stats.avg_ema || 0).toFixed(3)} 
            color="yellow"
          />
          <StatCard 
            label="Avg Access Count" 
            value={(stats.stats.avg_access_count || 0).toFixed(1)} 
            color="cyan"
          />
          <div className="flex flex-col justify-center">
            <button
              onClick={handleForceDecay}
              disabled={loading}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                loading 
                  ? 'bg-gray-600 cursor-not-allowed' 
                  : 'bg-blue-600 hover:bg-blue-700'
              } text-white`}
            >
              {loading ? 'Running...' : 'Force Decay Cycle'}
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="px-6 border-b border-gray-700">
        <div className="flex space-x-4">
          <TabButton 
            active={activeTab === 'overview'} 
            onClick={() => setActiveTab('overview')}
            label="Overview"
            count={stats?.nearingPromotion.length || 0}
          />
          <TabButton 
            active={activeTab === 'promotion'} 
            onClick={() => setActiveTab('promotion')}
            label="Nearing Promotion"
            count={stats?.nearingPromotion.length || 0}
          />
          <TabButton 
            active={activeTab === 'decay'} 
            onClick={() => setActiveTab('decay')}
            label="At Risk of Decay"
            count={stats?.nearingDecay.length || 0}
          />
          <TabButton 
            active={activeTab === 'activity'} 
            onClick={() => setActiveTab('activity')}
            label="Recent Activity"
            count={stats?.recentActivity.length || 0}
          />
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'overview' && stats && (
          <OverviewTab stats={stats} formatTimeAgo={formatTimeAgo} />
        )}
        {activeTab === 'promotion' && stats && (
          <PromotionTab 
            links={stats.nearingPromotion} 
            getPromotionProgress={getPromotionProgress}
            formatTimeAgo={formatTimeAgo}
          />
        )}
        {activeTab === 'decay' && stats && (
          <DecayTab 
            links={stats.nearingDecay} 
            getDecayRisk={getDecayRisk}
            formatTimeAgo={formatTimeAgo}
          />
        )}
        {activeTab === 'activity' && stats && (
          <ActivityTab 
            links={stats.recentActivity} 
            formatTimeAgo={formatTimeAgo}
          />
        )}
      </div>
    </div>
  );
};

// Stat Card Component
const StatCard: React.FC<{
  label: string;
  value: number | string;
  color: string;
}> = ({ label, value, color }) => {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-500/20 border-blue-500',
    purple: 'bg-purple-500/20 border-purple-500',
    green: 'bg-green-500/20 border-green-500',
    yellow: 'bg-yellow-500/20 border-yellow-500',
    cyan: 'bg-cyan-500/20 border-cyan-500',
  };

  return (
    <div className={`p-4 rounded-lg border ${colorClasses[color] || colorClasses.blue}`}>
      <div className="text-sm text-gray-400">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
};

// Tab Button Component
const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}> = ({ active, onClick, label, count }) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 font-medium transition-colors relative ${
      active 
        ? 'text-blue-400' 
        : 'text-gray-400 hover:text-gray-300'
    }`}
  >
    {label}
    {count !== undefined && count > 0 && (
      <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
        active ? 'bg-blue-400/20 text-blue-400' : 'bg-gray-700 text-gray-400'
      }`}>
        {count}
      </span>
    )}
  </button>
);

// Overview Tab
const OverviewTab: React.FC<{
  stats: HebbianStats;
  formatTimeAgo: (date?: string) => string;
}> = ({ stats, formatTimeAgo }) => {
  return (
    <div className="space-y-6">
      {/* Link Distribution Chart */}
      <div className="p-4 rounded-lg bg-gray-800">
        <h3 className="text-lg font-semibold mb-4">Link Status Distribution</h3>
        <div className="flex items-center space-x-4">
          <div className="flex-1 h-8 rounded-full overflow-hidden flex">
            {stats.stats.volatile_links > 0 && (
              <div 
                className="bg-purple-500" 
                style={{ width: `${(stats.stats.volatile_links / stats.stats.total_links) * 100}%` }}
              />
            )}
            {stats.stats.foundational_links > 0 && (
              <div 
                className="bg-green-500" 
                style={{ width: `${(stats.stats.foundational_links / stats.stats.total_links) * 100}%` }}
              />
            )}
            {stats.stats.archived_links > 0 && (
              <div 
                className="bg-gray-600" 
                style={{ width: `${(stats.stats.archived_links / stats.stats.total_links) * 100}%` }}
              />
            )}
          </div>
        </div>
        <div className="flex justify-between mt-2 text-sm">
          <span className="text-purple-400">Volatile: {stats.stats.volatile_links}</span>
          <span className="text-green-400">Foundational: {stats.stats.foundational_links}</span>
          <span className="text-gray-400">Archived: {stats.stats.archived_links}</span>
        </div>
      </div>

      {/* Top Active Links */}
      <div className="p-4 rounded-lg bg-gray-800">
        <h3 className="text-lg font-semibold mb-4">Most Active Links (Last 7 Days)</h3>
        <div className="space-y-2">
          {stats.recentActivity.slice(0, 10).map((link, idx) => (
            <div key={`${link.source_id}-${link.target_id}`} className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0">
              <div className="flex items-center space-x-3">
                <span className="text-gray-400 text-sm">{idx + 1}.</span>
                <span className="font-mono text-blue-400">{link.source_id}</span>
                <span className="text-gray-500">→</span>
                <span className="font-mono text-blue-400">{link.target_id}</span>
              </div>
              <div className="flex items-center space-x-4 text-sm">
                <span className="text-purple-400">Count: {link.access_count}</span>
                <span className="text-yellow-400">EMA: {link.access_ema.toFixed(3)}</span>
                <span className="text-gray-500">{formatTimeAgo(link.last_accessed)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Promotion Tab
const PromotionTab: React.FC<{
  links: HebbianLink[];
  getPromotionProgress: (link: HebbianLink) => { countProgress: number; emaProgress: number };
  formatTimeAgo: (date?: string) => string;
}> = ({ links, getPromotionProgress, formatTimeAgo }) => {
  if (links.length === 0) {
    return (
      <div className="text-center text-gray-400 py-12">
        No links nearing promotion criteria
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-400 mb-4">
        Fast-track: ≥50 accesses in 7 days AND EMA {'>'} 0.3 | Stability: ≥30 days old AND EMA {'>'} 0.001
      </div>
      {links.map((link) => {
        const progress = getPromotionProgress(link);
        return (
          <div key={`${link.source_id}-${link.target_id}`} className="p-4 rounded-lg bg-gray-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <span className="font-mono text-blue-400">{link.source_id}</span>
                <span className="text-gray-500">→</span>
                <span className="font-mono text-blue-400">{link.target_id}</span>
              </div>
              <span className="text-sm text-gray-500">{formatTimeAgo(link.created_at)}</span>
            </div>
            
            {/* Progress Bars */}
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-purple-400">Access Count</span>
                  <span className="text-gray-400">{link.access_count}/50 ({progress.countProgress.toFixed(0)}%)</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div 
                    className="bg-purple-500 transition-all" 
                    style={{ width: `${progress.countProgress}%` }}
                  />
                </div>
              </div>
              
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-yellow-400">EMA Strength</span>
                  <span className="text-gray-400">{link.access_ema.toFixed(3)}/0.3 ({progress.emaProgress.toFixed(0)}%)</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div 
                    className="bg-yellow-500 transition-all" 
                    style={{ width: `${progress.emaProgress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Decay Tab
const DecayTab: React.FC<{
  links: HebbianLink[];
  getDecayRisk: (link: HebbianLink) => number;
  formatTimeAgo: (date?: string) => string;
}> = ({ links, getDecayRisk, formatTimeAgo }) => {
  if (links.length === 0) {
    return (
      <div className="text-center text-gray-400 py-12">
        No links at risk of decay
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-400 mb-4">
        Links with EMA {'<'} 0.3 and access count {'<'} 10 - will be pruned if not reinforced
      </div>
      {links.map((link) => {
        const risk = getDecayRisk(link);
        return (
          <div key={`${link.source_id}-${link.target_id}`} className="p-4 rounded-lg bg-gray-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <span className="font-mono text-blue-400">{link.source_id}</span>
                <span className="text-gray-500">→</span>
                <span className="font-mono text-blue-400">{link.target_id}</span>
              </div>
              <span className={`px-2 py-1 rounded text-xs ${
                risk > 70 ? 'bg-red-500/20 text-red-400' : 
                risk > 40 ? 'bg-yellow-500/20 text-yellow-400' : 
                'bg-orange-500/20 text-orange-400'
              }`}>
                {risk.toFixed(0)}% decay risk
              </span>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <div className="space-x-4">
                <span className="text-purple-400">Count: {link.access_count}</span>
                <span className="text-yellow-400">EMA: {link.access_ema.toFixed(3)}</span>
              </div>
              <span className="text-gray-500">Last accessed: {formatTimeAgo(link.last_accessed)}</span>
            </div>
            
            {/* Decay Risk Bar */}
            <div className="mt-2">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-red-400">Decay Risk</span>
                <span className="text-gray-400">{risk.toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className={`transition-all ${
                    risk > 70 ? 'bg-red-500' : 
                    risk > 40 ? 'bg-yellow-500' : 
                    'bg-orange-500'
                  }`} 
                  style={{ width: `${risk}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Activity Tab
const ActivityTab: React.FC<{
  links: HebbianLink[];
  formatTimeAgo: (date?: string) => string;
}> = ({ links, formatTimeAgo }) => {
  if (links.length === 0) {
    return (
      <div className="text-center text-gray-400 py-12">
        No recent activity
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {links.map((link) => (
        <div key={`${link.source_id}-${link.target_id}`} className="p-3 rounded-lg bg-gray-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="font-mono text-blue-400">{link.source_id}</span>
            <span className="text-gray-500">→</span>
            <span className="font-mono text-blue-400">{link.target_id}</span>
          </div>
          <div className="flex items-center space-x-4 text-sm">
            <span className="text-purple-400">{link.access_count} accesses</span>
            <span className="text-yellow-400">EMA: {link.access_ema.toFixed(3)}</span>
            <span className="text-gray-500">{formatTimeAgo(link.last_accessed)}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default HebbianDashboardScreen;
