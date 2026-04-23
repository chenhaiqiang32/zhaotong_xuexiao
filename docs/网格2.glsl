#define PI 3.14
#define TARGET_COUNT 15
#define GRID_CELL_SIZE.1
#define RED vec3(1.,0.,0.)
#define GREEN vec3(0.,1.,0.)
#define BLUE vec3(.051,.7294,.698)

vec2 getGridPosition(in vec2 uv)
{
	return vec2((uv.x/GRID_CELL_SIZE),(uv.y/GRID_CELL_SIZE));
}

void mainImage(out vec4 fragColor,in vec2 fragCoord)
{
	// Normalized frag coordinates
	vec2 uv=(fragCoord-(.5*iResolution.xy))/iResolution.y;
	
	vec2 gridBoundUV=getGridPosition(uv);
	
	vec2 cellBoundUV=gridBoundUV-round(gridBoundUV);
	
	float redIntensity=0.;
	float blueIntensity=0.;
	
	for(int targetIndex=0;targetIndex<TARGET_COUNT;++targetIndex)
	{
		float f_targetIndex=float(targetIndex);
		
		float trigOffset=(PI/float(TARGET_COUNT))*f_targetIndex;
		vec2 targetPosition=vec2(sin(iTime+trigOffset)*.51+tan(f_targetIndex+trigOffset),cos(iTime+trigOffset)*.1+sin(f_targetIndex+trigOffset));
		vec2 gridBoundTargetPosition=getGridPosition(targetPosition);
		vec2 edgeBoundPosition=vec2(gridBoundTargetPosition.x,gridBoundTargetPosition.y);
		
		// change the op between the lengths to subtraction for some extreme strobe effects
		float distanceToTarget=length(gridBoundUV-round(gridBoundTargetPosition))+length((gridBoundUV)-(edgeBoundPosition));
		
		redIntensity+=length(GRID_CELL_SIZE/(distanceToTarget*9.5)/cellBoundUV)*GRID_CELL_SIZE;
		
	}
	
	for(int targetIndex=0;targetIndex<TARGET_COUNT;++targetIndex)
	{
		float f_targetIndex=float(targetIndex);
		
		float trigOffset=(PI/float(TARGET_COUNT))*f_targetIndex;
		
		vec2 targetPosition=vec2(sin(iTime+trigOffset)*.51+sin(f_targetIndex+trigOffset),tan(iTime+trigOffset)*.1+sin(f_targetIndex+trigOffset));
		vec2 gridBoundTargetPosition=getGridPosition(targetPosition);
		vec2 edgeBoundPosition=vec2(gridBoundTargetPosition.x,gridBoundTargetPosition.y);
		
		float distanceToTarget=length(gridBoundUV-round(gridBoundTargetPosition))+distance(gridBoundUV,edgeBoundPosition);
		
		blueIntensity+=length(GRID_CELL_SIZE/(distanceToTarget*15.5)/cellBoundUV)*GRID_CELL_SIZE;
		
	}
	
	vec3 col=vec3(smoothstep(.2,1.,redIntensity+blueIntensity));
	
	col+=redIntensity*GREEN;
	col+=blueIntensity*BLUE;
	
	// Output to screen
	fragColor=vec4(col,1.);
}