import { useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { TopBar } from '@/components/TopBar';
import { ChatPanel } from '@/components/ChatPanel';
import { SimulationArena } from '@/components/SimulationArena';
import { MetricsPanel } from '@/components/MetricsPanel';
import { IterationTimeline } from '@/components/IterationTimeline';
import { useSimulation } from '@/hooks/useSimulation';
import { ChatMessage, UserInput } from '@/types/simulation';
import { websocketService } from '@/services/websocket';

const Index = () => {
  const simulation = useSimulation();
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState<Partial<UserInput>>({
    riskAppetite: 50,
    ideaMaturity: 'concept',
    targetAudience: [],
    goals: [],
  });
  const [isWaitingForCity, setIsWaitingForCity] = useState(false);
  const [isWaitingForCountry, setIsWaitingForCountry] = useState(false);

  const addSystemMessage = useCallback((content: string) => {
    const message: ChatMessage = {
      id: `sys-${Date.now()}`,
      type: 'system',
      content,
      timestamp: Date.now(),
    };
    setChatMessages(prev => [...prev, message]);
  }, []);

  const handleSendMessage = useCallback((content: string) => {
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      content,
      timestamp: Date.now(),
    };
    setChatMessages(prev => [...prev, userMessage]);

    // Store the idea
    if (!userInput.idea) {
      setUserInput(prev => ({ ...prev, idea: content }));
      
      // Simulate LLM response asking for more details
      setTimeout(() => {
        addSystemMessage("Great idea! I'll analyze it with our multi-agent system. First, let me know: Which city and country should we focus on for the market analysis?");
        setIsWaitingForCity(true);
      }, 500);
    }
  }, [userInput.idea, addSystemMessage]);

  const handleLocationSubmit = useCallback((country: string, city: string) => {
    setUserInput(prev => ({ ...prev, country, city }));
    setIsWaitingForCity(false);
    setIsWaitingForCountry(false);

    const locationMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: `${city}, ${country}`,
      timestamp: Date.now(),
    };
    setChatMessages(prev => [...prev, locationMessage]);

    setTimeout(() => {
      addSystemMessage(`Perfect! I'll simulate market reception in ${city}, ${country}. Use the top bar to fine-tune your target audience, risk appetite, and goals. When ready, the simulation will begin automatically.`);
      
      // Auto-start simulation after a delay (in real app, this would wait for full config)
      setTimeout(() => {
        addSystemMessage("Starting simulation with 19–24 AI agents representing your target market...");

        // Kick off backend simulation using the structured user input.
        const config = {
          idea: userInput.idea || '',
          category: userInput.category || 'general',
          targetAudience: userInput.targetAudience || [],
          country,
          city,
          riskAppetite: (userInput.riskAppetite ?? 50) / 100,
          ideaMaturity: userInput.ideaMaturity || 'concept',
          goals: userInput.goals || [],
        };

        simulation.startSimulation(config);
      }, 2000);
    }, 500);
  }, [addSystemMessage, simulation, userInput]);

  const handleCategoryChange = useCallback((value: string) => {
    setUserInput(prev => ({ ...prev, category: value }));
  }, []);

  const handleAudienceChange = useCallback((value: string[]) => {
    setUserInput(prev => ({ ...prev, targetAudience: value }));
  }, []);

  const handleRiskChange = useCallback((value: number) => {
    setUserInput(prev => ({ ...prev, riskAppetite: value }));
  }, []);

  const handleMaturityChange = useCallback((value: string) => {
    setUserInput(prev => ({ ...prev, ideaMaturity: value as UserInput['ideaMaturity'] }));
  }, []);

  const handleGoalsChange = useCallback((value: string[]) => {
    setUserInput(prev => ({ ...prev, goals: value }));
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <Header 
        simulationStatus={simulation.status} 
        isConnected={websocketService.isConnected()} 
      />

      {/* Top Bar - Filters */}
      <TopBar
        onCategoryChange={handleCategoryChange}
        onAudienceChange={handleAudienceChange}
        onRiskChange={handleRiskChange}
        onMaturityChange={handleMaturityChange}
        onGoalsChange={handleGoalsChange}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Chat */}
        <div className="w-80 min-w-[320px] border-r border-border/50 flex flex-col">
          <ChatPanel
            messages={chatMessages}
            reasoningFeed={simulation.reasoningFeed}
            onSendMessage={handleSendMessage}
            onLocationSubmit={handleLocationSubmit}
            isWaitingForCity={isWaitingForCity}
            isWaitingForCountry={isWaitingForCountry}
          />
        </div>

        {/* Center - Simulation Arena */}
        <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
          <div className="flex-1">
            <SimulationArena
              agents={simulation.agents}
              status={simulation.status}
              currentIteration={simulation.metrics.currentIteration}
              totalIterations={simulation.metrics.totalIterations}
              onReset={simulation.stopSimulation}
            />
          </div>
          
          {/* Iteration Timeline */}
          <IterationTimeline
            currentIteration={simulation.metrics.currentIteration}
            totalIterations={simulation.metrics.totalIterations}
          />
        </div>

        {/* Right Panel - Metrics */}
        <div className="w-80 min-w-[320px] border-l border-border/50">
          <MetricsPanel metrics={simulation.metrics} />
        </div>
      </div>
    </div>
  );
};

export default Index;
