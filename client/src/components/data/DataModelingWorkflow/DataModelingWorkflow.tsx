'use client';

import React, { useState, useEffect } from 'react';
import { 
    Steps, 
    Card, 
    Button, 
    Space, 
    Typography, 
    Tabs, 
    Rate, 
    Input, 
    message,
    Spin,
    Alert,
    Tag,
    Divider,
    Row,
    Col
} from 'antd';
import { 
    ExperimentOutlined, 
    CheckCircleOutlined, 
    EditOutlined, 
    EyeOutlined,
    DeploymentUnitOutlined,
    StarOutlined
} from '@ant-design/icons';
import { WorkflowNavigation, WorkflowStep } from '../WorkflowNavigation';

const { Step } = Steps;
const { Title, Text, Paragraph } = Typography;
// const { TabPane } = Tabs; // Deprecated - using items prop instead
const { TextArea } = Input;

interface DataModelingWorkflowProps {
    dataSourceId: string;
    onComplete: (result: any) => void;
    onCancel: () => void;
}

interface WorkflowData {
    workflow_id: string;
    data_source: any;
    ai_analysis: any;
    data_model: any;
    approval_workflow: any;
    performance: any;
}

const DataModelingWorkflow: React.FC<DataModelingWorkflowProps> = ({
    dataSourceId,
    onComplete,
    onCancel
}) => {
    const [loading, setLoading] = useState(false);
    const [currentStep, setCurrentStep] = useState(0);
    const [workflowData, setWorkflowData] = useState<WorkflowData | null>(null);
    const [yamlContent, setYamlContent] = useState('');
    const [feedback, setFeedback] = useState({
        accuracy_rating: 0,
        usefulness_rating: 0,
        suggestions: '',
        business_context_accuracy: 0
    });

    // Define workflow steps with validation
    const workflowSteps: WorkflowStep[] = [
        {
            key: 'review',
            title: 'Review Data Model',
            description: 'AI-generated visual representation',
            isRequired: true,
            isCompleted: !!workflowData?.data_model,
            canSkip: false
        },
        {
            key: 'customize',
            title: 'Customize Schema',
            description: 'Edit YAML configuration',
            isRequired: false,
            isCompleted: yamlContent.length > 0,
            canSkip: true
        },
        {
            key: 'feedback',
            title: 'Provide Feedback',
            description: 'Help improve AI accuracy',
            isRequired: false,
            isCompleted: feedback.accuracy_rating > 0,
            canSkip: true
        },
        {
            key: 'deploy',
            title: 'Deploy',
            description: 'Activate the schema',
            isRequired: true,
            isCompleted: false,
            canSkip: false
        }
    ];

    // Step validation function
    const canProceedToNext = (): boolean => {
        const currentStepData = workflowSteps[currentStep];
        if (!currentStepData) return false;
        
        if (currentStepData.isRequired && !currentStepData.isCompleted) {
            return false;
        }
        
        return true;
    };

    // Handle step change with validation
    const handleStepChange = (step: number) => {
        if (step > currentStep && !canProceedToNext()) {
            message.warning('Please complete the current step before proceeding');
            return;
        }
        setCurrentStep(step);
    };

    // Handle save and skip
    const handleSaveAndSkip = async () => {
        try {
            // Save current progress
            if (currentStep === 1) {
                // Save YAML customizations
                message.success('YAML customizations saved');
            } else if (currentStep === 2) {
                // Save feedback
                message.success('Feedback saved');
            }
            
            // Mark step as completed and move to next
            const updatedSteps = [...workflowSteps];
            updatedSteps[currentStep].isCompleted = true;
            
            // Move to next step
            if (currentStep < workflowSteps.length - 1) {
                setCurrentStep(currentStep + 1);
            }
        } catch (error) {
            message.error('Failed to save progress');
        }
    };

    useEffect(() => {
        startDataModeling();
    }, [dataSourceId]);

    const startDataModeling = async () => {
        try {
            setLoading(true);
            
            const response = await fetch('/api/charts/ai-data-modeling', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    data_source_id: dataSourceId,
                    user_context: {
                        user_preferences: {},
                        business_context: 'general'
                    }
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to start data modeling');
            }

            const result = await response.json();
            
            if (result.success) {
                setWorkflowData(result);
                setYamlContent(result.data_model?.yaml_schema || '');
                message.success('AI data modeling completed successfully!');
            } else {
                throw new Error(result.error || 'Data modeling failed');
            }
        } catch (error) {
            console.error('Data modeling error:', error);
            message.error(`Data modeling failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setLoading(false);
        }
    };

    const handleApproval = async (approvalType: string) => {
        try {
            setLoading(true);
            
            const approvalData = {
                type: approvalType,
                feedback: feedback,
                modifications: approvalType === 'customize' ? { yaml_config: yamlContent } : {}
            };

            const response = await fetch('/api/charts/approve-schema', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    workflow_id: workflowData?.approval_workflow?.workflow_id,
                    approval_data: approvalData
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to process approval');
            }

            const result = await response.json();
            
            if (result.success) {
                message.success('Schema approved and deployed successfully!');
                onComplete(result);
            } else {
                throw new Error(result.error || 'Approval failed');
            }
        } catch (error) {
            console.error('Approval error:', error);
            message.error(`Approval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setLoading(false);
        }
    };

    const renderVisualModel = () => {
        if (!workflowData?.data_model?.visual_representation) {
            return <div>No visual model available</div>;
        }

        const visualModel = workflowData.data_model.visual_representation;
        
        return (
            <div style={{ padding: '20px' }}>
                <Row gutter={[16, 16]}>
                    <Col span={24}>
                        <Card 
                            title={
                                <Space>
                                    <ExperimentOutlined />
                                    AI-Detected Business Domain: {visualModel.business_context}
                                </Space>
                            }
                            size="small"
                        >
                            <Row gutter={[16, 16]}>
                                <Col span={8}>
                                    <Card size="small" title="Measures">
                                        <Text strong>{visualModel.metrics_summary?.total_measures || 0}</Text>
                                        <br />
                                        <Text type="secondary">Numeric fields for aggregation</Text>
                                    </Card>
                                </Col>
                                <Col span={8}>
                                    <Card size="small" title="Dimensions">
                                        <Text strong>{visualModel.metrics_summary?.total_dimensions || 0}</Text>
                                        <br />
                                        <Text type="secondary">Categorical fields for grouping</Text>
                                    </Card>
                                </Col>
                                <Col span={8}>
                                    <Card size="small" title="Time Dimensions">
                                        <Text strong>{visualModel.metrics_summary?.total_time_dimensions || 0}</Text>
                                        <br />
                                        <Text type="secondary">Date/time fields for trends</Text>
                                    </Card>
                                </Col>
                            </Row>
                        </Card>
                    </Col>
                </Row>

                <Divider />

                {visualModel.entities?.map((entity: any, index: number) => (
                    <Card 
                        key={index}
                        title={`Data Cube: ${entity.name}`}
                        style={{ marginBottom: 16 }}
                    >
                        <Tabs 
                            defaultActiveKey="measures"
                            items={[
                                {
                                    key: 'measures',
                                    label: 'Measures',
                                    children: (
                                        <Space wrap>
                                            {entity.measures?.map((measure: any, idx: number) => (
                                                <Tag key={idx} color="blue">
                                                    {measure.name} ({measure.aggregation})
                                                </Tag>
                                            ))}
                                        </Space>
                                    )
                                },
                                {
                                    key: 'dimensions',
                                    label: 'Dimensions',
                                    children: (
                                        <Space wrap>
                                            {entity.dimensions?.map((dim: any, idx: number) => (
                                                <Tag key={idx} color="green">
                                                    {dim.name} ({dim.type})
                                                </Tag>
                                            ))}
                                        </Space>
                                    )
                                },
                                {
                                    key: 'time',
                                    label: 'Time Dimensions',
                                    children: (
                                        <Space wrap>
                                            {entity.time_dimensions?.map((timeDim: any, idx: number) => (
                                                <Tag key={idx} color="orange">
                                                    {timeDim.name} ({timeDim.granularities?.join(', ')})
                                                </Tag>
                                            ))}
                                        </Space>
                                    )
                                }
                            ]}
                        />
                    </Card>
                ))}
            </div>
        );
    };

    const renderYamlEditor = () => (
        <div style={{ padding: '20px' }}>
            <Alert
                message="Cube.js Schema Configuration"
                description="You can customize the AI-generated schema below. This YAML will be converted to Cube.js JavaScript configuration."
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
            />
            
            <TextArea
                rows={10}
                value={yamlContent}
                onChange={(e) => setYamlContent(e.target.value)}
                placeholder="Edit the YAML configuration..."
                style={{ fontFamily: 'monospace' }}
            />
        </div>
    );

    const renderFeedbackForm = () => (
        <div style={{ padding: '20px' }}>
            <Title level={4}>Provide Feedback</Title>
            <Paragraph type="secondary">
                Your feedback helps improve our AI data modeling capabilities.
            </Paragraph>
            
            <Space direction="vertical" style={{ width: '100%' }} size="large">
                <div>
                    <Text strong>How accurate is the AI analysis?</Text>
                    <br />
                    <Rate 
                        value={feedback.accuracy_rating} 
                        onChange={(value) => setFeedback({...feedback, accuracy_rating: value})}
                    />
                </div>
                
                <div>
                    <Text strong>How useful is the generated schema?</Text>
                    <br />
                    <Rate 
                        value={feedback.usefulness_rating} 
                        onChange={(value) => setFeedback({...feedback, usefulness_rating: value})}
                    />
                </div>
                
                <div>
                    <Text strong>How accurate is the business context detection?</Text>
                    <br />
                    <Rate 
                        value={feedback.business_context_accuracy} 
                        onChange={(value) => setFeedback({...feedback, business_context_accuracy: value})}
                    />
                </div>
                
                <div>
                    <Text strong>Additional suggestions:</Text>
                    <TextArea
                        rows={4}
                        value={feedback.suggestions}
                        onChange={(e) => setFeedback({...feedback, suggestions: e.target.value})}
                        placeholder="Any suggestions for improvement..."
                    />
                </div>
            </Space>
        </div>
    );

    if (loading && !workflowData) {
        return (
            <Card style={{ textAlign: 'center', padding: '40px' }}>
                <Spin size="large" />
                <br />
                <br />
                <Title level={4}>AI is analyzing your data...</Title>
                <Paragraph type="secondary">
                    This may take a few moments while we generate the optimal data model.
                </Paragraph>
            </Card>
        );
    }

    if (!workflowData) {
        return (
            <Card>
                <Alert
                    message="Data Modeling Failed"
                    description="Unable to start the data modeling workflow. Please try again."
                    type="error"
                    showIcon
                />
            </Card>
        );
    }

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <Card 
                title={
                    <Space>
                        <ExperimentOutlined />
                        AI Data Modeling Workflow
                    </Space>
                }
                extra={
                    <Space>
                        <Tag color="blue">
                            Confidence: {Math.round((workflowData.ai_analysis?.confidence || 0) * 100)}%
                        </Tag>
                        <Tag color="green">
                            {workflowData.performance?.model_used || 'GPT-4o-mini'}
                        </Tag>
                    </Space>
                }
            >
                <Steps current={currentStep} style={{ marginBottom: 24 }}>
                    <Step 
                        title="Review Data Model" 
                        description="AI-generated visual representation"
                        icon={<EyeOutlined />}
                    />
                    <Step 
                        title="Customize Schema" 
                        description="Edit YAML configuration"
                        icon={<EditOutlined />}
                    />
                    <Step 
                        title="Provide Feedback" 
                        description="Help improve AI accuracy"
                        icon={<StarOutlined />}
                    />
                    <Step 
                        title="Deploy" 
                        description="Activate the schema"
                        icon={<DeploymentUnitOutlined />}
                    />
                </Steps>

                <Card style={{ minHeight: '500px' }}>
                    {currentStep === 0 && renderVisualModel()}
                    {currentStep === 1 && renderYamlEditor()}
                    {currentStep === 2 && renderFeedbackForm()}
                    {currentStep === 3 && (
                        <div style={{ textAlign: 'center', padding: '40px' }}>
                            <CheckCircleOutlined style={{ fontSize: '64px', color: '#52c41a' }} />
                            <Title level={3}>Ready to Deploy!</Title>
                            <Paragraph>
                                Your data model is ready. Click "Deploy Schema" to activate it and start creating charts.
                            </Paragraph>
                        </div>
                    )}
                </Card>

                {/* Enhanced Navigation */}
                <WorkflowNavigation
                    currentStep={currentStep}
                    totalSteps={workflowSteps.length}
                    steps={workflowSteps}
                    onStepChange={handleStepChange}
                    onCancel={onCancel}
                    onSave={handleSaveAndSkip}
                    onComplete={() => handleApproval('approve_all')}
                    loading={loading}
                    canProceed={canProceedToNext()}
                    showProgress={true}
                    customActions={
                        currentStep === 3 && (
                            <Space>
                                <Button 
                                    type="primary" 
                                    loading={loading}
                                    onClick={() => handleApproval('approve_all')}
                                >
                                    Deploy Schema
                                </Button>
                                <Button 
                                    loading={loading}
                                    onClick={() => handleApproval('customize')}
                                >
                                    Deploy with Customizations
                                </Button>
                            </Space>
                        )
                    }
                />
            </Card>
        </div>
    );
};

export default DataModelingWorkflow;