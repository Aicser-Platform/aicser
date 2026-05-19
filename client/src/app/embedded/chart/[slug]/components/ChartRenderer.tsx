import * as echarts from 'echarts';
import React from 'react';

function ChartRenderer({ value }: { value: string }) {
    const chartRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const chart = echarts.init(chartRef.current);

        const rawOption = JSON.parse(value);
        const option = JSON.parse(
            JSON.stringify(rawOption, (key, value) =>
                value === null ? undefined : value
            )
        );

        chart.setOption({
            ...option,
            maintainAspectRatio: false,
            grid: {
                top: 60,
                left: '3%',
                right: '3%',
                bottom: 60,
                containLabel: true,
            },
            tooltip: {
                trigger: 'axis',
            },
            legend: {
                type: 'scroll',
                bottom: 10,
                textStyle: {
                    color: getComputedStyle(
                        document.documentElement
                    ).getPropertyValue('--text-color'),
                },
            },
            toolbox: {
                show: true,
                orient: 'vertical',
                left: 'right',
                top: 'center',
                feature: {
                    mark: { show: true },
                    dataView: { show: true, readOnly: false },
                    magicType: { show: true, type: ['line', 'bar', 'stack'] },
                    restore: { show: true },
                    saveAsImage: { show: true },
                },
            },
        });

        // Handle window resize
        const handleResize = () => chart.resize();
        window.addEventListener('resize', handleResize);

        return () => {
            chart.dispose();
            window.removeEventListener('resize', handleResize);
        };
    }, [value]);

    return <div ref={chartRef} className="h-screen w-screen" />;
}

export default ChartRenderer;
