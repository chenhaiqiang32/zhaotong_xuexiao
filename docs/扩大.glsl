// Fork of "10 - Line grid" by Krabcode. https://shadertoy.com/view/3s3yR7
// 2020-09-21 17:53:36

// Based on ideas from LiveCoding - The Universe Within by Art of Code
// https://youtu.be/3CycKKJiwis

#define tau 6.28

float scl=15.;

mat2 rotate(float rad){
	float c=cos(rad);
	float s=sin(rad);
	return mat2(c,-s,s,c);
}

// cubic pulse by iq
float cubicPulse(float c,float w,float x)
{
	x=abs(x-c);
	if(x>w)return 0.;
	x/=w;
	return 1.-x*x*(3.-2.*x);
}

// 2D sdf by iq
float sdOrientedBox(in vec2 p,in vec2 a,in vec2 b,float th)
{
	float l=length(b-a);
	vec2 d=(b-a)/l;
	vec2 q=(p-(a+b)*.5);
	q=mat2(d.x,-d.y,d.y,d.x)*q;
	q=abs(q)-vec2(l,th)*.5;
	return length(max(q,0.))+min(max(q.x,q.y),0.);
}

float sdRoundedLine(in vec2 p,in vec2 a,in vec2 b,float weight,float roundedness){
	return sdOrientedBox(p,a,b,weight)-roundedness;
}

float sdGridLine(vec2 cellPos,vec2 a,vec2 b){
	float lineLength=distance(a,b);
	float line=sdOrientedBox(cellPos,a,b,0.);
	float smallLength=0.;
	float bigLength=1.5;
	float closeness=smoothstep(bigLength,smallLength,lineLength);
	float thickness=.05;
	return closeness*smoothstep(thickness,0.,line);
}

// Hash without Sine
// David Hoskins.

float hash12(vec2 p)
{
	vec3 p3=fract(vec3(p.xyx)*.1031);
	p3+=dot(p3,p3.yzx+33.33);
	return fract((p3.x+p3.y)*p3.z);
}

vec2 getGridPoint(vec2 id){
	float t=float(iFrame)*.001;
	float d=smoothstep(scl*.33,0.,length(id));
	float theta=tau*(t+731.154*hash12(id));
	float x=d*.4*cos(theta);
	float y=d*.4*sin(theta);
	vec2 wave=(1.-d)*.03*id*sin(length(id)-t*scl*.66);
	return vec2(x,y)+wave;
}

float allLinesOnThisCell(vec2 cellPos,vec2[9]points){
	float sum=0.;
	sum+=sdGridLine(cellPos,points[4],points[0]);
	sum+=sdGridLine(cellPos,points[4],points[1]);
	sum+=sdGridLine(cellPos,points[4],points[2]);
	sum+=sdGridLine(cellPos,points[4],points[3]);
	sum+=sdGridLine(cellPos,points[4],points[5]);
	sum+=sdGridLine(cellPos,points[4],points[6]);
	sum+=sdGridLine(cellPos,points[4],points[7]);
	sum+=sdGridLine(cellPos,points[4],points[8]);
	sum+=sdGridLine(cellPos,points[1],points[3]);
	sum+=sdGridLine(cellPos,points[1],points[5]);
	sum+=sdGridLine(cellPos,points[3],points[7]);
	sum+=sdGridLine(cellPos,points[5],points[7]);
	return sum;
}

vec2[9]createPointMatrix(vec2 cellId){
	vec2[9]pointMatrix;
	float range=1.;
	int i=0;
	for(float x=-range;x<=range;x++){
		for(float y=-range;y<=range;y++){
			vec2 offset=vec2(x,y);
			pointMatrix[i]=getGridPoint(cellId+offset)+offset;
			i++;
		}
	}
	return pointMatrix;
}

float render(vec2 uv){
	float pct=.12;
	vec2 cellPos=fract(uv*scl)-.5;
	vec2 cellId=floor(uv*scl)+.5;
	vec2[9]pointMatrix=createPointMatrix(cellId);
	return allLinesOnThisCell(cellPos,pointMatrix);
}

vec3 gammaCorrection(vec3 rgb){
	float gamma=2.2;
	return pow(max(rgb,0.),vec3(1./gamma));
}

void mainImage(out vec4 fragColor,in vec2 fragCoord)
{
	vec2 uv=(fragCoord-.5*iResolution.xy)/iResolution.y;
	vec2 colorOffset=normalize(uv)*.003*smoothstep(.2,.5,length(uv));
	vec3 col=vec3(
		render(uv-colorOffset),
		render(uv),
		render(uv+colorOffset));
		fragColor=vec4(gammaCorrection(col),1.);
	}
	