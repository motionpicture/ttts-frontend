module.exports = function (grunt) {
    grunt.initConfig({
        // nsp: {
        //   package: grunt.file.readJSON("package.json")
        // },

        //jsdoc config
        jsdoc: {
            dist: {
                src: [
                    "README.md",
                    "app/**/*.js"
                ],
                options: {
                    destination: "docs",
                    template: "node_modules/ink-docstrap/template",
                    // configure: "node_modules/ink-docstrap/template/jsdoc.conf.json"
                    configure: "jsdoc.json"
                }
            }
        },

        watch: {
        }
    });

    grunt.loadNpmTasks("grunt-jsdoc");
    grunt.loadNpmTasks("grunt-contrib-watch");
    // grunt.loadNpmTasks("grunt-nsp");

    // grunt.registerTask("doc", ["jsdoc"]);
};
