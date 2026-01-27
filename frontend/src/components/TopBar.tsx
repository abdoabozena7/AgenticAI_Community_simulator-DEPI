import { useState } from 'react';
import { ChevronDown, Zap, Target, AlertTriangle, Lightbulb, Flag } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface TopBarProps {
  onCategoryChange: (value: string) => void;
  onAudienceChange: (value: string[]) => void;
  onRiskChange: (value: number) => void;
  onMaturityChange: (value: string) => void;
  onGoalsChange: (value: string[]) => void;
}

const categories = [
  'Technology', 'Healthcare', 'Finance', 'Education', 'E-commerce',
  'Entertainment', 'Social', 'B2B SaaS', 'Consumer Apps', 'Hardware'
];

const audiences = [
  'Gen Z (18-24)', 'Millennials (25-40)', 'Gen X (41-56)', 'Boomers (57-75)',
  'Developers', 'Enterprises', 'SMBs', 'Consumers', 'Students', 'Professionals'
];

const maturityLevels = [
  { value: 'concept', label: 'Concept', icon: '💡' },
  { value: 'prototype', label: 'Prototype', icon: '🔧' },
  { value: 'mvp', label: 'MVP', icon: '🚀' },
  { value: 'launched', label: 'Launched', icon: '✅' },
];

const goalOptions = [
  'Market Validation', 'Funding Readiness', 'User Acquisition',
  'Product-Market Fit', 'Competitive Analysis', 'Growth Strategy'
];

export function TopBar({
  onCategoryChange,
  onAudienceChange,
  onRiskChange,
  onMaturityChange,
  onGoalsChange,
}: TopBarProps) {
  const [selectedAudiences, setSelectedAudiences] = useState<string[]>([]);
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [riskLevel, setRiskLevel] = useState(50);
  const [maturity, setMaturity] = useState('concept');

  const toggleAudience = (audience: string) => {
    const updated = selectedAudiences.includes(audience)
      ? selectedAudiences.filter(a => a !== audience)
      : [...selectedAudiences, audience];
    setSelectedAudiences(updated);
    onAudienceChange(updated);
  };

  const toggleGoal = (goal: string) => {
    const updated = selectedGoals.includes(goal)
      ? selectedGoals.filter(g => g !== goal)
      : [...selectedGoals, goal];
    setSelectedGoals(updated);
    onGoalsChange(updated);
  };

  const handleRiskChange = (value: number[]) => {
    setRiskLevel(value[0]);
    onRiskChange(value[0]);
  };

  const getRiskLabel = (value: number) => {
    if (value < 30) return 'Conservative';
    if (value < 70) return 'Moderate';
    return 'Aggressive';
  };

  const getRiskColor = (value: number) => {
    if (value < 30) return 'text-success';
    if (value < 70) return 'text-warning';
    return 'text-destructive';
  };

  return (
    <div className="glass-panel border-b border-border/50 px-6 py-4">
      <div className="flex items-center gap-6 overflow-x-auto scrollbar-thin">
        {/* Category Select */}
        <div className="flex items-center gap-3 min-w-[200px]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Lightbulb className="w-4 h-4" />
            <span className="text-sm font-medium">Category</span>
          </div>
          <Select onValueChange={onCategoryChange}>
            <SelectTrigger className="w-[160px] bg-secondary border-border/50">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat.toLowerCase()}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-px h-8 bg-border/50" />

        {/* Target Audience Multi-select */}
        <div className="flex items-center gap-3 min-w-[280px]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Target className="w-4 h-4" />
            <span className="text-sm font-medium">Audience</span>
          </div>
          <div className="flex flex-wrap gap-1.5 max-w-[200px]">
            {selectedAudiences.length === 0 ? (
              <span className="text-sm text-muted-foreground">None selected</span>
            ) : (
              selectedAudiences.slice(0, 2).map((aud) => (
                <Badge
                  key={aud}
                  variant="secondary"
                  className="bg-primary/20 text-primary border-primary/30 text-xs cursor-pointer hover:bg-primary/30"
                  onClick={() => toggleAudience(aud)}
                >
                  {aud.split(' ')[0]}
                </Badge>
              ))
            )}
            {selectedAudiences.length > 2 && (
              <Badge variant="secondary" className="text-xs">
                +{selectedAudiences.length - 2}
              </Badge>
            )}
          </div>
          <Select onValueChange={(val) => toggleAudience(val)}>
            <SelectTrigger className="w-8 h-8 p-0 bg-secondary border-border/50">
              <ChevronDown className="w-4 h-4" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border max-h-[300px]">
              {audiences.map((aud) => (
                <SelectItem 
                  key={aud} 
                  value={aud}
                  className={cn(selectedAudiences.includes(aud) && "bg-primary/10")}
                >
                  {aud}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-px h-8 bg-border/50" />

        {/* Risk Appetite Slider */}
        <div className="flex items-center gap-3 min-w-[200px]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">Risk</span>
          </div>
          <div className="flex items-center gap-3">
            <Slider
              value={[riskLevel]}
              onValueChange={handleRiskChange}
              max={100}
              step={1}
              className="w-24"
            />
            <span className={cn("text-sm font-medium min-w-[80px]", getRiskColor(riskLevel))}>
              {getRiskLabel(riskLevel)}
            </span>
          </div>
        </div>

        <div className="w-px h-8 bg-border/50" />

        {/* Idea Maturity */}
        <div className="flex items-center gap-3 min-w-[220px]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Zap className="w-4 h-4" />
            <span className="text-sm font-medium">Maturity</span>
          </div>
          <div className="flex gap-1">
            {maturityLevels.map((level) => (
              <button
                key={level.value}
                onClick={() => {
                  setMaturity(level.value);
                  onMaturityChange(level.value);
                }}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                  maturity === level.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                )}
              >
                <span className="mr-1">{level.icon}</span>
                {level.label}
              </button>
            ))}
          </div>
        </div>

        <div className="w-px h-8 bg-border/50" />

        {/* Goals Multi-select */}
        <div className="flex items-center gap-3 min-w-[200px]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Flag className="w-4 h-4" />
            <span className="text-sm font-medium">Goals</span>
          </div>
          <div className="flex flex-wrap gap-1.5 max-w-[150px]">
            {selectedGoals.length === 0 ? (
              <span className="text-sm text-muted-foreground">None</span>
            ) : (
              selectedGoals.slice(0, 1).map((goal) => (
                <Badge
                  key={goal}
                  variant="secondary"
                  className="bg-accent/20 text-accent border-accent/30 text-xs cursor-pointer"
                  onClick={() => toggleGoal(goal)}
                >
                  {goal.split(' ')[0]}
                </Badge>
              ))
            )}
            {selectedGoals.length > 1 && (
              <Badge variant="secondary" className="text-xs">
                +{selectedGoals.length - 1}
              </Badge>
            )}
          </div>
          <Select onValueChange={(val) => toggleGoal(val)}>
            <SelectTrigger className="w-8 h-8 p-0 bg-secondary border-border/50">
              <ChevronDown className="w-4 h-4" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {goalOptions.map((goal) => (
                <SelectItem 
                  key={goal} 
                  value={goal}
                  className={cn(selectedGoals.includes(goal) && "bg-primary/10")}
                >
                  {goal}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
