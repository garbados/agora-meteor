let VERT_SHADER_SOURCE = "\
uniform mat3 u_mat;\n\
attribute vec2 in_pos;\n\
void main() {\n\
    gl_PointSize = 16.0;\n\
    vec3 pos = vec3(in_pos, 1.0)*u_mat;\n\
    gl_Position = vec4(pos.xy, 0.0, 1.0);\n\
}";

//Looks complicated and horrible, but this just draws circles.
let POST_FRAG_SHADER_SOURCE = "\
#ifdef GL_OES_standard_derivatives\n\
#extension GL_OES_standard_derivatives : enable\n\
#endif\n\
precision mediump float;\n\
void main() {\n\
    float alpha = 1.0;\n\
    vec2 p = gl_PointCoord*2.0 - 1.0;\n\
    float r = dot(p, p);\n\
#ifdef GL_OES_standard_derivatives\n\
    //float delta = fwidth(r);\n\
    //alpha = 1.0 - smoothstep(1.0 - delta, 1.0 + delta, r);\n\
    float delta = fwidth(r);\n\
    alpha = smoothstep(1.0, 1.0 - delta, r);\n\
#else\n\
    if (r > 1.0) {\n\
        discard;\n\
    }\n\
#endif\n\
    gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);\n\
}";

let LINK_FRAG_SHADER_SOURCE = "\
precision mediump float;\n\
void main() {\n\
    gl_FragColor = vec4(1.0);\n\
}";

let loadShader = function(gl, source, type) {
    let shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.log(gl.getShaderInfoLog(shader));
    }
    return shader;
}

let linkShaderProgram = function(gl, vertShader, fragShader) {
    let shader = gl.createProgram();
    gl.attachShader(shader, vertShader);
    gl.attachShader(shader, fragShader);
    gl.linkProgram(shader);
    if (!gl.getProgramParameter(shader, gl.LINK_STATUS)) {
        console.log(gl.getProgramInfoLog(shader));
        return null;
    }
    shader.locMatrix = gl.getUniformLocation(shader, 'u_mat');
    return shader;
}

WebGLRenderer = function(canvas) {
    let self = this;
    
    let gl = canvas[0].getContext('experimental-webgl');
    gl.clearColor(0.0, 0.192, 0.325, 1.0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.getExtension('OES_standard_derivatives');
    
    //Set up resize callback
    this.isDestroyed = false;
    let sizeDirty = true;
    
    $(window).resize(function() {
        sizeDirty = true;
    });
    
    //Set up shader program
    let vertShader = loadShader(gl, VERT_SHADER_SOURCE, gl.VERTEX_SHADER);
    let postFragShader = loadShader(gl, POST_FRAG_SHADER_SOURCE, gl.FRAGMENT_SHADER);
    let linkFragShader = loadShader(gl, LINK_FRAG_SHADER_SOURCE, gl.FRAGMENT_SHADER);
    let postShader = linkShaderProgram(gl, vertShader, postFragShader);
    let linkShader = linkShaderProgram(gl, vertShader, linkFragShader);
    
    //Set up post vertex buffer
    let MAX_POSTS = 1000;
    let MAX_LINKS = 1000;
    
    let vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_POSTS*8, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    
    //Set up link index buffer
    let ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, MAX_LINKS*4, gl.DYNAMIC_DRAW);
    
    let postCount = 0;
    
    //Main render loop
    let render = function() {
        if (self.isDestroyed) {
            return;
        }
        
        if (sizeDirty) {
            canvas[0].width = canvas.width();
            canvas[0].height = canvas.height();
            gl.viewport(0, 0, canvas[0].width, canvas[0].height);
            
            let projection = [2.0/canvas[0].width, 0.0, 0.0,
                          0.0, 2.0/canvas[0].height, 0.0,
                          0.0, 0.0, 1.0];
                          
            gl.useProgram(postShader);
            gl.uniformMatrix3fv(postShader.locMatrix, false, projection);
            gl.useProgram(linkShader);
            gl.uniformMatrix3fv(linkShader.locMatrix, false, projection);
            
            sizeDirty = false;
        }
        
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(postShader);
        gl.drawArrays(gl.POINTS, 0, postCount*2);
        gl.useProgram(linkShader);
        gl.drawElements(gl.LINES, 0, gl.UNSIGNED_SHORT, 0);
        
        window.requestAnimationFrame(render);
    }
    
    this.begin = function() {
        window.requestAnimationFrame(render);
    }
    
    this.addPost = function(post) {
        let pos = [post.defaultPosition.x*32.0, post.defaultPosition.y*32.0];
        gl.bufferSubData(gl.ARRAY_BUFFER, postCount*8, new Float32Array(pos));
        postCount++;
    }
    
    this.stop = function() {
        self.isDestroyed = true;
        $(window).off('resize'); //Destroy resize callback
    }
}