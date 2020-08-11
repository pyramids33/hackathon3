const asyncHandler = function (fn) {
    return function (req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(function (error) {
            console.log(error.stack); 
            next(error);
        });
    }
}
module.exports = asyncHandler;